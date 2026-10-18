// Serves our reference price to Stitch, skewed by the agent's live inventory
// and gated by the risk manager. Point Stitch's price feed at
// http://127.0.0.1:8787/price?pair=wars-usdt (or pair=wbrl-usdt).
//
//   npm run feed                 # port 8787, refresh every 15 s
//   npm run feed -- --port 9000 --refresh 30
//   npm run feed -- --reset-kill # clear a tripped kill switch, then serve
//   npm run feed -- --data tmp   # keep risk state and heartbeat elsewhere (for tests)
//
// GET /health returns the same heartbeat written to data/heartbeat.json.
import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { createCeloClient } from "../src/chain/celo.js";
import { readInventory } from "../src/chain/inventory.js";
import { loadEnv, required } from "../src/config/env.js";
import { DEFAULT_PARAMS, type QuoteParams } from "../src/engine/params.js";
import { createPairFeed } from "../src/feeds/pairs.js";
import { createHeartbeatFile, type Heartbeat, type PairHealth } from "../src/lifecycle/heartbeat.js";
import { createShutdown, installShutdownHandlers } from "../src/lifecycle/shutdown.js";
import { createRiskManager, DEFAULT_LIMITS, type RiskDecision } from "../src/risk/riskManager.js";
import { createRiskStore } from "../src/risk/store.js";
import { createFeedServer } from "../src/stitch/feedServer.js";
import { STITCH_PAIRS } from "../src/stitch/print.js";
import { createSkewTracker } from "../src/stitch/skew.js";
import { createPriceHistory } from "../src/supervisor/context.js";
import { createChat } from "../src/supervisor/llm.js";
import { buildLiveContext } from "../src/supervisor/live.js";
import { createParamsStore } from "../src/supervisor/paramsStore.js";
import { createSupervisor, jsonlRecorder } from "../src/supervisor/supervisor.js";

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: "8787" },
    refresh: { type: "string", default: "15" },
    "reset-kill": { type: "boolean", default: false },
    data: { type: "string", default: "data" },
  },
});
const port = Number(args.port);

const env = loadEnv();
const owner = privateKeyToAccount(required(env, "PRIVATE_KEY")).address;
const client = createCeloClient(env.CELO_RPC_URL);

// Stitch's RFQ responder drops prints older than [feed].rfq_staleness_secs
// (180 in our stitch.toml; Stitch's default for wars-usdt is only 60). Our
// print is as old as its oldest source, so drop sources older than 150 s.
const STITCH_MAX_AGE_MS = 150_000;
// Stitch's RFQ loop re-reads the feed every second; give it a few to see a
// degraded print before the server goes away.
const GO_DARK_GRACE_MS = 3_000;

let halted = false;

const agents = Object.fromEntries(
  Object.entries(STITCH_PAIRS).map(([slug, pair]) => {
    const store = createRiskStore(`${args.data}/risk-${slug}.json`);
    const risk = createRiskManager(DEFAULT_LIMITS, args["reset-kill"] ? undefined : store.load());
    if (args["reset-kill"]) store.save(risk.snapshot());
    const paramsStore = createParamsStore(`${args.data}/params-${slug}.json`);
    const agent = {
      // Set by the supervisor; persisted so a restart keeps its last decision.
      params: paramsStore.load() ?? DEFAULT_PARAMS,
      paramsStore,
      history: createPriceHistory(),
      feed: createPairFeed(pair, fetch, { maxAgeMs: STITCH_MAX_AGE_MS }),
      skew: createSkewTracker({ params: (): QuoteParams => agent.params, readInventory: () => readInventory(client, owner, pair) }),
      risk,
      store,
      // Fail closed until the first evaluation.
      decision: { paused: true, reasons: ["starting up"], killed: null, drawdown: 0 } as RiskDecision,
      health: {
        quoting: false, reasons: ["starting up"], ref: null, published: null, skewBps: 0,
        inventory: null, drawdown: 0, killed: null, lastRefresh: 0,
      } as PairHealth,
    };
    return [slug, agent];
  }),
);

const heartbeatFile = createHeartbeatFile(`${args.data}/heartbeat.json`);
const heartbeat: Heartbeat = {
  at: Date.now(), startedAt: Date.now(), pid: process.pid, state: "running", stopReason: null, pairs: {},
};
function beat() {
  heartbeat.at = Date.now();
  heartbeat.pairs = Object.fromEntries(Object.entries(agents).map(([slug, a]) => [slug, a.health]));
  heartbeatFile.write(heartbeat);
}

const { server, refresh, stop } = createFeedServer({
  feeds: Object.fromEntries(Object.entries(agents).map(([slug, a]) => [slug, a.feed])),
  refreshMs: Number(args.refresh) * 1000,
  adjustment(slug) {
    const a = agents[slug]!;
    const s = a.skew.get();
    return { skew: s.skew, paused: halted || s.paused || a.decision.paused };
  },
  health: () => heartbeat,
  async onRefresh(slug, ref) {
    const a = agents[slug]!;
    const time = new Date().toISOString().slice(11, 19);
    if (!ref.ok) {
      a.health = { ...a.health, quoting: false, reasons: [`no price: ${ref.reason}`], lastRefresh: Date.now() };
      beat();
      return console.log(`${time} ${slug} NO PRICE: ${ref.reason}`);
    }

    a.history.add(Date.now(), ref.price);
    const s = await a.skew.update(ref.price);
    const textile = ref.used.find((q) => q.source.startsWith("textile:"));
    const textileOutlier = ref.rejected.some((r) => r.source.startsWith("textile:") && r.reason.startsWith("outlier"));
    const wasKilled = a.decision.killed;
    if (s.inventory) {
      a.decision = a.risk.evaluate({
        now: Date.now(),
        ref: ref.price,
        ...(textile && { textile: textile.price }),
        textileOutlier,
        nav: s.inventory.base + s.inventory.quote / ref.price,
      });
      a.store.save(a.risk.snapshot());
    }
    if (a.decision.killed && !wasKilled) {
      console.error(`\n🔴 ${slug} KILL SWITCH TRIPPED: ${a.decision.killed}. Restart with --reset-kill to resume.\n`);
    }

    const reasons = [...(s.inventory ? [] : ["inventory unavailable"]), ...(s.paused && s.inventory ? ["paused by params"] : []), ...a.decision.reasons];
    const published = ref.price * (1 - s.skew);
    a.health = {
      quoting: reasons.length === 0,
      reasons,
      ref: ref.price,
      published,
      skewBps: s.skew * 1e4,
      inventory: s.inventory,
      drawdown: a.decision.drawdown,
      killed: a.decision.killed,
      lastRefresh: Date.now(),
    };
    beat();

    const sources = ref.used.map((q) => q.source.split(":")[0]).join(",");
    const inv = s.inventory
      ? `inv ${s.inventory.base.toFixed(2)} USD₮ + ${s.inventory.quote.toFixed(0)}, ${((s.baseShare ?? 0) * 100).toFixed(0)}% USD₮`
      : "inventory unavailable";
    console.log(
      `${time} ${slug} ref ${ref.price.toFixed(2)} → ${published.toFixed(2)} (skew ${(s.skew * 1e4).toFixed(1)} bps) ` +
        `| ${inv} | ${reasons.length ? `PAUSED: ${reasons.join("; ")}` : "quoting"} [${sources}]`,
    );
  },
});

// --- LLM supervisor: every 10 min on wars-usdt, off without an API key. -----
const SUPERVISOR_EVERY_MS = 10 * 60_000;
// Must match buy_offset_bps / sell_offset_bps in stitch.toml.
const STITCH_SPREAD_BPS_PER_SIDE = 20;
const supervised = agents["wars-usdt"]!;
const recentDecisions: { time: string; reason: string }[] = [];
let supervisorTimer: NodeJS.Timeout | undefined;

if (env.LLM_API_KEY) {
  const supervisor = createSupervisor({
    chat: createChat({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL }),
    getParams: () => supervised.params,
    setParams(p) {
      supervised.params = p;
      supervised.paramsStore.save(p);
    },
    record: jsonlRecorder(`${args.data}/decisions.jsonl`),
  });
  const runSupervisor = async () => {
    const inventory = supervised.skew.get().inventory;
    const refPrice = supervised.health.ref;
    if (halted || !inventory || refPrice === null) return;
    const context = await buildLiveContext({
      me: owner, client, refPrice, history: supervised.history, inventory, risk: supervised.decision,
      params: supervised.params, stitchSpreadBpsPerSide: STITCH_SPREAD_BPS_PER_SIDE, recentDecisions: [...recentDecisions],
    });
    const r = await supervisor.run(context);
    const time = new Date().toISOString().slice(11, 19);
    if (r.decision) {
      recentDecisions.push({ time: r.time, reason: r.decision.reason });
      if (recentDecisions.length > 3) recentDecisions.shift();
      const p = r.after;
      console.log(
        `${time} 🧠 supervisor: share ${p.targetBaseShare} skew ${(p.maxSkew * 1e4).toFixed(1)} bps band ${p.inventoryBand}` +
          `${p.paused ? " PAUSED" : ""} — ${r.decision.reason}`,
      );
    } else {
      console.log(`${time} 🧠 supervisor failed, keeping params: ${r.error}`);
    }
  };
  // First run after a minute of price history, then every 10 min.
  setTimeout(() => void runSupervisor().catch((e) => console.error("supervisor:", e)), 60_000);
  supervisorTimer = setInterval(() => void runSupervisor().catch((e) => console.error("supervisor:", e)), SUPERVISOR_EVERY_MS);
  console.log(`🧠 supervisor on (${env.LLM_MODEL}), every ${SUPERVISOR_EVERY_MS / 60_000} min`);
} else {
  console.log("🧠 supervisor off: set LLM_API_KEY in .env to enable it");
}

const { shutdown } = createShutdown({
  steps: [
    {
      name: "go dark (degraded prints, so Stitch stops quoting)",
      timeoutMs: GO_DARK_GRACE_MS + 1_000,
      async run(reason) {
        halted = true;
        clearInterval(supervisorTimer);
        heartbeat.state = "stopping";
        heartbeat.stopReason = reason;
        beat();
        await new Promise((r) => setTimeout(r, GO_DARK_GRACE_MS));
      },
    },
    { name: "save risk state", run: () => Object.values(agents).forEach((a) => a.store.save(a.risk.snapshot())) },
    { name: "stop feed server", run: () => stop() },
    {
      name: "final heartbeat",
      run() {
        heartbeat.state = "stopped";
        beat();
      },
    },
  ],
});
installShutdownHandlers(shutdown);

await refresh();
server.listen(port, "127.0.0.1", () => {
  console.log(`Stitch feed on http://127.0.0.1:${port}/price?pair=<${Object.keys(agents).join("|")}>  (Ctrl+C to stop)`);
});
