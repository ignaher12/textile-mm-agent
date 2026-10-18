// One-screen health check of the live agent, read entirely from the outside:
// agent process, wallet, our feed vs Textile's, our live quotes vs the market,
// recent fills.
//
//   npm run status                # fills from the last 24 h
//   npm run status -- --hours 72
import { parseArgs } from "node:util";
import { formatUnits, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKENS, createCeloClient } from "../src/chain/celo.js";
import { findMakerFills } from "../src/chain/fills.js";
import { readInventory } from "../src/chain/inventory.js";
import { loadEnv, required } from "../src/config/env.js";
import { createHeartbeatFile, heartbeatSchema, type Heartbeat } from "../src/lifecycle/heartbeat.js";
import { previewRfq, type Preview } from "../src/textile/rfq.js";

const { values: args } = parseArgs({
  options: {
    hours: { type: "string", default: "24" },
    feed: { type: "string", default: "http://127.0.0.1:8787/price?pair=wars-usdt" },
    data: { type: "string", default: "data" },
  },
});

const CHAIN_ID = 42220;
const PROBE_USDT = 2; // trade size used to probe quotes, in USD₮

const env = loadEnv();
const me = privateKeyToAccount(required(env, "PRIVATE_KEY")).address;
const client = createCeloClient(env.CELO_RPC_URL);

const bps = (x: number) => `${(x * 1e4).toFixed(1)} bps`;

async function getJson(url: string): Promise<{ price: number; timestamp: number; degraded?: boolean } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function getHealth(): Promise<Heartbeat | null> {
  try {
    const res = await fetch(new URL("/health", args.feed), { signal: AbortSignal.timeout(5_000) });
    return res.ok ? heartbeatSchema.parse(await res.json()) : null;
  } catch {
    return null;
  }
}

const ago = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
};

function printAgent(live: Heartbeat | null) {
  console.log(`\nAgent process`);
  const hb = live ?? createHeartbeatFile(`${args.data}/heartbeat.json`).read();
  if (!hb) return console.log("  ✗ no heartbeat: the feed server has never run here (or --data points elsewhere)");

  const age = Date.now() - hb.at;
  if (!live) {
    console.log(
      hb.state === "running"
        ? `  ✗ DOWN: last heartbeat ${ago(age)} ago while running — crashed, killed or the PC slept`
        : `  ✗ STOPPED ${ago(age)} ago (clean OFF: ${hb.stopReason ?? "unknown"})`,
    );
  } else {
    console.log(`  ✓ ${hb.state}, up ${ago(hb.at - hb.startedAt)}, last refresh ${ago(age)} ago`);
  }
  const pair = hb.pairs["wars-usdt"];
  if (pair) {
    console.log(
      `  wars-usdt  ${pair.quoting ? "quoting" : `PAUSED: ${pair.reasons.join("; ")}`}` +
        `  skew ${pair.skewBps.toFixed(1)} bps  drawdown ${(pair.drawdown * 100).toFixed(2)}%`,
    );
  }
}

async function main() {
  const [inventory, textile, ours, head, health] = await Promise.all([
    readInventory(client, me, "USDT/ARS"),
    getJson(`https://api.textilecredit.com/price?chainId=${CHAIN_ID}&pair=wars-usdt`),
    getJson(args.feed),
    client.getBlockNumber(),
    getHealth(),
  ]);
  if (!textile) throw new Error("Textile price endpoint unreachable");
  const mid = textile.price; // USD₮ per wARS
  const now = Math.floor(Date.now() / 1000);

  console.log(`\nAgent ${me}`);
  console.log(`  Wallet   ${inventory.base.toFixed(4)} USD₮ + ${inventory.quote.toFixed(2)} wARS` +
    `  (≈ ${(inventory.base + inventory.quote * mid).toFixed(4)} USD₮)`);

  printAgent(health);

  console.log(`\nFeed (USD₮ per wARS)`);
  console.log(`  Textile  ${mid.toPrecision(6)}  ${now - textile.timestamp}s old`);
  console.log(
    ours
      ? `  Ours     ${ours.price.toPrecision(6)}  ${now - ours.timestamp}s old  ${bps(ours.price / mid - 1)} vs Textile (our skew + source differences)` +
          (ours.degraded ? "  ⚠ DEGRADED (Stitch is not quoting)" : "")
      : `  Ours     ✗ unreachable at ${args.feed} — Stitch is not quoting. Is \`npm run feed\` running?`,
  );

  // A trader selling wARS hits makers' bids; a trader selling USD₮ hits their asks.
  const sides = [
    { label: "We buy wARS  (trader sells wARS)", sell: TOKENS.wARS, buy: TOKENS.USDT, amount: parseUnits((PROBE_USDT / mid).toFixed(0), 18), sign: -1 },
    { label: "We sell wARS (trader sells USD₮)", sell: TOKENS.USDT, buy: TOKENS.wARS, amount: parseUnits(String(PROBE_USDT), 6), sign: 1 },
  ];
  console.log(`\nQuotes for a ~${PROBE_USDT} USD₮ trade, vs Textile mid`);
  for (const side of sides) {
    const req = { chainId: CHAIN_ID, sellToken: side.sell.address, buyToken: side.buy.address, sellAmount: side.amount };
    const [mine, market] = await Promise.all([previewRfq({ ...req, restrictTo: [me] }), previewRfq(req)]);
    // Distance from mid on the maker's side: below mid for bids, above for asks.
    const show = (p: Preview | { error: string }) =>
      "error" in p ? `— (${p.error})` : `${bps(side.sign * (p.rate / mid - 1))} ${side.sign < 0 ? "below" : "above"} mid`;
    const capacity =
      "error" in mine || mine.availableSellAmount === null
        ? ""
        : `, capacity ${Number(formatUnits(mine.availableSellAmount, side.sell.decimals)).toFixed(2)} ${side.sell.symbol}`;
    console.log(`  ${side.label}`);
    console.log(`    ours    ${show(mine)}${capacity}`);
    console.log(`    best    ${show(market)}`);
  }

  const hours = Number(args.hours);
  const from = head - BigInt(Math.round(hours * 3600)); // Celo: ~1 s blocks
  const fills = await findMakerFills(client, me, from, head);
  console.log(`\nFills in the last ${hours} h: ${fills.length}`);
  for (const f of fills) console.log(`  block ${f.blockNumber}  taker ${f.taker}  https://celoscan.io/tx/${f.txHash}`);
  console.log("");
}

await main();
