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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { formatStatus, handleCommand } from "../src/bot/commands.js";
import { createTelegram } from "../src/bot/telegram.js";
import { createCeloClient } from "../src/chain/celo.js";
import { findMakerFills } from "../src/chain/fills.js";
import { readInventory } from "../src/chain/inventory.js";
import { loadEnv, required } from "../src/config/env.js";
import { DEFAULT_PARAMS, type QuoteParams } from "../src/engine/params.js";
import { createPairFeed } from "../src/feeds/pairs.js";
import { createHeartbeatFile, type Heartbeat, type PairHealth } from "../src/lifecycle/heartbeat.js";
import { createMetricsLog } from "../src/lifecycle/metrics.js";
import { createShutdown, installShutdownHandlers } from "../src/lifecycle/shutdown.js";
import { createRiskManager, DEFAULT_LIMITS, type RiskDecision } from "../src/risk/riskManager.js";
import { createRiskStore } from "../src/risk/store.js";
import { createFeedServer } from "../src/stitch/feedServer.js";
import { STITCH_PAIRS } from "../src/stitch/print.js";
import { createSkewTracker } from "../src/stitch/skew.js";
import { marketSnapshot } from "../src/textile/market.js";
import { createPriceHistory } from "../src/supervisor/context.js";
import { createChat } from "../src/supervisor/llm.js";
import { buildLiveContext } from "../src/supervisor/live.js";
import { createParamsStore } from "../src/supervisor/paramsStore.js";
import { createSupervisor, jsonlRecorder, type DecisionRecord } from "../src/supervisor/supervisor.js";

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

// --- Telegram: alerts and remote control. Off without a token and chat id. ---
const telegram =
  env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
    ? createTelegram({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID })
    : null;
const notify = (text: string) =>
  telegram ? telegram.send(text).catch((e) => console.error(`telegram: ${e instanceof Error ? e.message : e}`)) : Promise.resolve();

// /pause survives restarts: a paused agent must not come back quoting on its own.
const controlFile = `${args.data}/control.json`;
let manualPause = existsSync(controlFile) ? Boolean(JSON.parse(readFileSync(controlFile, "utf8")).manualPause) : false;
function setManualPause(paused: boolean) {
  manualPause = paused;
  mkdirSync(args.data, { recursive: true });
  writeFileSync(controlFile, JSON.stringify({ manualPause }));
}

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
    return { skew: s.skew, paused: halted || manualPause || s.paused || a.decision.paused };
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
      void notify(`🔴 ${slug} KILL SWITCH: ${a.decision.killed}\nQuoting stopped. Restart with npm start -- --reset-kill once you've checked why.`);
    }

    const reasons = [
      ...(manualPause ? ["paused by you (/pause)"] : []),
      ...(s.inventory ? [] : ["inventory unavailable"]),
      ...(s.paused && s.inventory ? ["paused by the supervisor"] : []),
      ...a.decision.reasons,
    ];
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
    if (slug === "wars-usdt") watchQuoting(a.health);

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

// Alert on quoting ↔ paused changes, once a state has held for two refreshes
// (a source going briefly stale shouldn't page anyone).
let announcedQuoting: boolean | null = null;
let pending: { quoting: boolean; count: number } | null = null;
function watchQuoting(h: PairHealth) {
  pending = pending?.quoting === h.quoting ? { quoting: h.quoting, count: pending.count + 1 } : { quoting: h.quoting, count: 1 };
  if (pending.count < 2 || pending.quoting === announcedQuoting) return;
  const first = announcedQuoting === null;
  announcedQuoting = pending.quoting;
  if (first && h.quoting) return; // the startup message already says so
  void notify(h.quoting ? "🟢 wARS/USD₮ quoting again" : `🟡 wARS/USD₮ paused: ${h.reasons.join("; ")}`);
}

// --- LLM supervisor: every 10 min on wars-usdt, off without an API key. -----
const SUPERVISOR_EVERY_MS = 10 * 60_000;
// Must match buy_offset_bps / sell_offset_bps in stitch.toml.
const STITCH_SPREAD_BPS_PER_SIDE = 20;
const supervised = agents["wars-usdt"]!;
const recentDecisions: { time: string; reason: string }[] = [];
let supervisorTimer: NodeJS.Timeout | undefined;
let lastDecision: DecisionRecord | null = null;

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
      skewNow: { bps: supervised.skew.get().skew * 1e4, imbalance: supervised.skew.get().imbalance ?? 0 },
      params: supervised.params, stitchSpreadBpsPerSide: STITCH_SPREAD_BPS_PER_SIDE, recentDecisions: [...recentDecisions],
    });
    const r = await supervisor.run(context);
    lastDecision = r;
    const time = new Date().toISOString().slice(11, 19);
    if (r.decision) {
      recentDecisions.push({ time: r.time, reason: r.decision.reason });
      if (recentDecisions.length > 3) recentDecisions.shift();
      const p = r.after;
      console.log(
        `${time} 🧠 supervisor: share ${p.targetBaseShare} band ${p.inventoryBand} ` +
          `skew cap ${(Math.min(p.maxSkew, p.spread / 4) * 1e4).toFixed(1)} bps${p.paused ? " PAUSED" : ""}` +
          `${r.decision.recommendedSpreadBps !== undefined ? ` (recommends spread ${r.decision.recommendedSpreadBps} bps/side)` : ""}` +
          ` — ${r.decision.reason}`,
      );
      const b = r.before;
      const changed =
        b.targetBaseShare !== p.targetBaseShare || b.maxSkew !== p.maxSkew || b.inventoryBand !== p.inventoryBand || b.paused !== p.paused;
      if (changed) {
        void notify(
          `🧠 Supervisor changed the policy\n${r.decision.reason}\n\n` +
            `USD₮ share ${b.targetBaseShare} → ${p.targetBaseShare}, band ${b.inventoryBand} → ${p.inventoryBand}, ` +
            `skew cap ${(Math.min(b.maxSkew, b.spread / 4) * 1e4).toFixed(1)} → ${(Math.min(p.maxSkew, p.spread / 4) * 1e4).toFixed(1)} bps` +
            (b.paused !== p.paused ? `, paused ${b.paused} → ${p.paused}` : ""),
        );
      }
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

// --- Fill watcher: alert on every fill of an order we signed. ---------------
const FILL_SCAN_EVERY_MS = 5 * 60_000;
let fillsFrom = await client.getBlockNumber();
const fillTimer = setInterval(async () => {
  try {
    const head = await client.getBlockNumber();
    const fills = await findMakerFills(client, owner, fillsFrom + 1n, head);
    fillsFrom = head;
    for (const f of fills) void notify(`💱 Fill! taker ${f.taker}\nhttps://celoscan.io/tx/${f.txHash}`);
  } catch (e) {
    console.error(`fill scan: ${e instanceof Error ? e.message : e}`);
  }
}, FILL_SCAN_EVERY_MS);

// --- Metrics: a sample every 5 min for the evidence report (npm run report). --
const METRICS_EVERY_MS = 5 * 60_000;
const metricsLog = createMetricsLog(`${args.data}/metrics.jsonl`);
async function sampleMetrics() {
  const h = supervised.health;
  const market = h.ref === null ? null : await marketSnapshot(owner, 1 / h.ref).catch(() => null);
  const inv = h.inventory;
  metricsLog.append({
    t: Date.now(),
    quoting: h.quoting && !halted,
    reasons: h.reasons,
    ref: h.ref,
    skewBps: h.skewBps,
    usdt: inv?.base ?? null,
    local: inv?.quote ?? null,
    navUsdt: inv && h.ref ? inv.base + inv.quote / h.ref : null,
    market,
  });
}
const metricsTimer = setInterval(() => void sampleMetrics().catch((e) => console.error("metrics:", e)), METRICS_EVERY_MS);

// --- Telegram heartbeat: a status message every 6 h. If they stop, the agent is down.
const HEARTBEAT_EVERY_MS = 6 * 3600_000;
const heartbeatTimer = setInterval(
  () => void notify(`💓 ${formatStatus(supervised.health, Date.now() - heartbeat.startedAt, manualPause)}`),
  HEARTBEAT_EVERY_MS,
);

const { shutdown } = createShutdown({
  steps: [
    {
      name: "go dark (degraded prints, so Stitch stops quoting)",
      timeoutMs: GO_DARK_GRACE_MS + 1_000,
      async run(reason) {
        halted = true;
        clearInterval(supervisorTimer);
        clearInterval(fillTimer);
        clearInterval(heartbeatTimer);
        clearInterval(metricsTimer);
        telegram?.stop();
        heartbeat.state = "stopping";
        heartbeat.stopReason = reason;
        beat();
        await new Promise((r) => setTimeout(r, GO_DARK_GRACE_MS));
      },
    },
    { name: "save risk state", run: () => Object.values(agents).forEach((a) => a.store.save(a.risk.snapshot())) },
    { name: "notify Telegram", run: (reason) => notify(`🔴 Agent stopped (${reason}). Stitch is not quoting.`) },
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

telegram?.listen(async (text) =>
  handleCommand(text, {
    health: () => supervised.health,
    uptimeMs: () => Date.now() - heartbeat.startedAt,
    lastDecision: () => lastDecision,
    manualPause: () => manualPause,
    setManualPause,
    off: (reason) => void shutdown(reason).then((r) => process.exit(r.failed.length > 0 ? 1 : 0)),
  }),
);
console.log(telegram ? "📱 Telegram bot on" : "📱 Telegram off: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env");

await refresh();
server.listen(port, "127.0.0.1", () => {
  console.log(`Stitch feed on http://127.0.0.1:${port}/price?pair=<${Object.keys(agents).join("|")}>  (Ctrl+C to stop)`);
  void sampleMetrics().catch((e) => console.error("metrics:", e));
  void notify(`🟢 Agent started\n\n${formatStatus(supervised.health, 0, manualPause)}`);
});
