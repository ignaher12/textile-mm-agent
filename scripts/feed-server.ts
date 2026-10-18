// Serves our reference price to Stitch, skewed by the agent's live inventory.
// Point Stitch's price feed at http://127.0.0.1:8787/price?pair=wars-usdt
// (or pair=wbrl-usdt).
//
//   npm run feed                 # port 8787, refresh every 15 s
//   npm run feed -- --port 9000 --refresh 30
import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { createCeloClient } from "../src/chain/celo.js";
import { readInventory } from "../src/chain/inventory.js";
import { loadEnv, required } from "../src/config/env.js";
import { DEFAULT_PARAMS } from "../src/engine/params.js";
import { createPairFeed } from "../src/feeds/pairs.js";
import { createFeedServer } from "../src/stitch/feedServer.js";
import { STITCH_PAIRS } from "../src/stitch/print.js";
import { createSkewTracker } from "../src/stitch/skew.js";

const { values: args } = parseArgs({
  options: { port: { type: "string", default: "8787" }, refresh: { type: "string", default: "15" } },
});
const port = Number(args.port);

const env = loadEnv();
const owner = privateKeyToAccount(required(env, "PRIVATE_KEY")).address;
const client = createCeloClient(env.CELO_RPC_URL);

// Stitch's RFQ responder drops prints older than [feed].rfq_staleness_secs
// (180 in our stitch.toml; Stitch's default for wars-usdt is only 60). Our
// print is as old as its oldest source, so drop sources older than 150 s.
const STITCH_MAX_AGE_MS = 150_000;

const pairs = Object.entries(STITCH_PAIRS);
const feeds = Object.fromEntries(
  pairs.map(([slug, pair]) => [slug, createPairFeed(pair, fetch, { maxAgeMs: STITCH_MAX_AGE_MS })]),
);
const skews = Object.fromEntries(
  pairs.map(([slug, pair]) => [
    slug,
    createSkewTracker({ params: () => DEFAULT_PARAMS, readInventory: () => readInventory(client, owner, pair) }),
  ]),
);

const { server, refresh, stop } = createFeedServer({
  feeds,
  refreshMs: Number(args.refresh) * 1000,
  adjustment: (slug) => skews[slug]!.get(),
  async onRefresh(slug, ref) {
    const time = new Date().toISOString().slice(11, 19);
    if (!ref.ok) return console.log(`${time} ${slug} NO PRICE: ${ref.reason}`);

    const s = await skews[slug]!.update(ref.price);
    const sources = ref.used.map((q) => q.source.split(":")[0]).join(",");
    const inv = s.inventory
      ? `inv ${s.inventory.base.toFixed(2)} USD₮ + ${s.inventory.quote.toFixed(0)}, ${((s.baseShare ?? 0) * 100).toFixed(0)}% USD₮`
      : "inventory unavailable";
    const published = ref.price * (1 - s.skew);
    console.log(
      `${time} ${slug} ref ${ref.price.toFixed(2)} → ${published.toFixed(2)} ` +
        `(skew ${(s.skew * 1e4).toFixed(1)} bps${s.paused ? ", PAUSED" : ""}) | ${inv} [${sources}]`,
    );
  },
});

await refresh();
server.listen(port, "127.0.0.1", () => {
  console.log(`Stitch feed on http://127.0.0.1:${port}/price?pair=<${Object.keys(feeds).join("|")}>`);
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => (stop(), process.exit(0)));
