// Serves our reference price to Stitch, skewed by the agent's live inventory
// and gated by the risk manager. Point Stitch's price feed at
// http://127.0.0.1:8787/price?pair=wars-usdt (or pair=wbrl-usdt).
//
//   npm run feed                 # port 8787, refresh every 15 s
//   npm run feed -- --port 9000 --refresh 30
//   npm run feed -- --reset-kill # clear a tripped kill switch, then serve
import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { createCeloClient } from "../src/chain/celo.js";
import { readInventory } from "../src/chain/inventory.js";
import { loadEnv, required } from "../src/config/env.js";
import { DEFAULT_PARAMS } from "../src/engine/params.js";
import { createPairFeed } from "../src/feeds/pairs.js";
import { createRiskManager, DEFAULT_LIMITS, type RiskDecision } from "../src/risk/riskManager.js";
import { createRiskStore } from "../src/risk/store.js";
import { createFeedServer } from "../src/stitch/feedServer.js";
import { STITCH_PAIRS } from "../src/stitch/print.js";
import { createSkewTracker } from "../src/stitch/skew.js";

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: "8787" },
    refresh: { type: "string", default: "15" },
    "reset-kill": { type: "boolean", default: false },
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

const agents = Object.fromEntries(
  Object.entries(STITCH_PAIRS).map(([slug, pair]) => {
    const store = createRiskStore(`data/risk-${slug}.json`);
    const risk = createRiskManager(DEFAULT_LIMITS, args["reset-kill"] ? undefined : store.load());
    if (args["reset-kill"]) store.save(risk.snapshot());
    return [
      slug,
      {
        feed: createPairFeed(pair, fetch, { maxAgeMs: STITCH_MAX_AGE_MS }),
        skew: createSkewTracker({ params: () => DEFAULT_PARAMS, readInventory: () => readInventory(client, owner, pair) }),
        risk,
        store,
        // Fail closed until the first evaluation.
        decision: { paused: true, reasons: ["starting up"], killed: null, drawdown: 0 } as RiskDecision,
      },
    ];
  }),
);

const { server, refresh, stop } = createFeedServer({
  feeds: Object.fromEntries(Object.entries(agents).map(([slug, a]) => [slug, a.feed])),
  refreshMs: Number(args.refresh) * 1000,
  adjustment(slug) {
    const a = agents[slug]!;
    const s = a.skew.get();
    return { skew: s.skew, paused: s.paused || a.decision.paused };
  },
  async onRefresh(slug, ref) {
    const a = agents[slug]!;
    const time = new Date().toISOString().slice(11, 19);
    if (!ref.ok) return console.log(`${time} ${slug} NO PRICE: ${ref.reason}`);

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

    const sources = ref.used.map((q) => q.source.split(":")[0]).join(",");
    const inv = s.inventory
      ? `inv ${s.inventory.base.toFixed(2)} USD₮ + ${s.inventory.quote.toFixed(0)}, ${((s.baseShare ?? 0) * 100).toFixed(0)}% USD₮`
      : "inventory unavailable";
    const published = ref.price * (1 - s.skew);
    const state = s.paused || a.decision.paused ? `PAUSED: ${a.decision.reasons.join("; ") || "inventory unavailable"}` : "quoting";
    console.log(
      `${time} ${slug} ref ${ref.price.toFixed(2)} → ${published.toFixed(2)} (skew ${(s.skew * 1e4).toFixed(1)} bps) ` +
        `| ${inv} | ${state} [${sources}]`,
    );
  },
});

await refresh();
server.listen(port, "127.0.0.1", () => {
  console.log(`Stitch feed on http://127.0.0.1:${port}/price?pair=<${Object.keys(agents).join("|")}>`);
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => (stop(), process.exit(0)));
