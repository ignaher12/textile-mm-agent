// Serves our reference price to Stitch. Point Stitch's [feed] url at
// http://127.0.0.1:8787/price?pair=wars-usdt (or pair=wbrl-usdt).
//
//   npm run feed                 # port 8787
//   npm run feed -- --port 9000
import { parseArgs } from "node:util";
import { createPairFeed } from "../src/feeds/pairs.js";
import { createFeedServer } from "../src/stitch/feedServer.js";
import { STITCH_PAIRS } from "../src/stitch/print.js";

const { values: args } = parseArgs({
  options: { port: { type: "string", default: "8787" }, refresh: { type: "string", default: "15" } },
});
const port = Number(args.port);

const feeds = Object.fromEntries(
  Object.entries(STITCH_PAIRS).map(([slug, pair]) => [slug, createPairFeed(pair)]),
);

const { server, refresh, stop } = createFeedServer({
  feeds,
  refreshMs: Number(args.refresh) * 1000,
  onRefresh(slug, ref) {
    const time = new Date().toISOString().slice(11, 19);
    const sources = ref.used.map((q) => q.source.split(":")[0]).join(",");
    console.log(
      ref.ok
        ? `${time} ${slug} ${ref.price.toFixed(4)} per USD₮ [${sources}]`
        : `${time} ${slug} NO PRICE: ${ref.reason}`,
    );
  },
});

await refresh();
server.listen(port, "127.0.0.1", () => {
  console.log(`Stitch feed on http://127.0.0.1:${port}/price?pair=<${Object.keys(feeds).join("|")}>`);
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => (stop(), process.exit(0)));
