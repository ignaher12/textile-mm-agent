// Backtests the quoting engine on historical or synthetic prices.
//
//   npm run sim                                   # 30 days of real wARS history
//   npm run sim -- --data calm                    # synthetic scenario
//   npm run sim -- --data devaluation --sweep     # compare spreads
import { parseArgs } from "node:util";
import { DEFAULT_PARAMS, clampParams, type QuoteParams } from "../src/engine/params.js";
import { COINGECKO_IDS, PAIRS, type PairId } from "../src/feeds/pairs.js";
import { SCENARIOS, fetchCoinGeckoHistory, syntheticPrices, type PricePoint, type Scenario } from "./prices.js";
import { createRng } from "./rng.js";
import { runSimulation, type SimConfig, type SimResult } from "./simulator.js";

const { values: args } = parseArgs({
  options: {
    data: { type: "string", default: "history" },
    pair: { type: "string", default: "USDT/ARS" },
    days: { type: "string", default: "30" },
    seed: { type: "string", default: "1" },
    spread: { type: "string", default: String(DEFAULT_PARAMS.spread) },
    size: { type: "string", default: String(DEFAULT_PARAMS.orderSize) },
    skew: { type: "string", default: String(DEFAULT_PARAMS.maxSkew) },
    capital: { type: "string", default: "100" },
    "taker-rate": { type: "string", default: "0.3" },
    decay: { type: "string", default: "0.5" },
    gas: { type: "string", default: "0.001" },
    fee: { type: "string", default: "0" },
    requote: { type: "string", default: "0.002" },
    sweep: { type: "boolean", default: false },
  },
});

const days = Number(args.days);
const seed = Number(args.seed);
const prices = await loadPrices(args.data, args.pair, days, seed);
const startPrice = prices[0]!.price;
const capital = Number(args.capital);

const baseConfig: Omit<SimConfig, "params"> = {
  prices,
  // Start balanced: half the capital in USD₮, half in local currency.
  initialInventory: { base: capital / 2, quote: (capital / 2) * startPrice },
  fillModel: { takerRate: Number(args["taker-rate"]), decay: Number(args.decay) },
  gasPerRequote: Number(args.gas),
  requoteThreshold: Number(args.requote),
  feeRate: Number(args.fee),
  seed,
};

const params: QuoteParams = clampParams({
  ...DEFAULT_PARAMS,
  spread: Number(args.spread),
  orderSize: Number(args.size),
  maxSkew: Number(args.skew),
});

const endPrice = prices[prices.length - 1]!.price;
console.log(
  `\nData: ${args.data} · ${args.pair} · ${prices.length} hourly points · ` +
    `${startPrice.toFixed(2)} → ${endPrice.toFixed(2)} ` +
    `(${(((endPrice - startPrice) / startPrice) * 100).toFixed(2)}%)`,
);
console.log(`Capital: ${capital} USD₮ (balanced) · fill model: ${JSON.stringify(baseConfig.fillModel)}\n`);

if (args.sweep) {
  const rows = [0.005, 0.01, 0.02, 0.03, 0.05, 0.08].map((spread) => {
    const result = runSimulation({ ...baseConfig, params: clampParams({ ...params, spread }) });
    return { spread: pct(spread), ...summarize(result) };
  });
  console.table(rows);
} else {
  const result = runSimulation({ ...baseConfig, params });
  console.log("Params:", params);
  console.table([summarize(result)]);
  const crossing = result.fills.filter((f) => f.kind === "crossing").length;
  console.log(`Fills: ${result.fills.length} (${crossing} adverse crossings)`);
  console.log(
    `Final inventory: ${result.finalInventory.base.toFixed(2)} USD₮ + ` +
      `${result.finalInventory.quote.toFixed(0)} ${args.pair.split("/")[1]}`,
  );
}

function summarize(r: SimResult) {
  return {
    "P&L (USD₮)": r.pnl.toFixed(3),
    "P&L %": pct(r.pnlPct),
    "vs hold": r.alpha.toFixed(3),
    "volume (USD₮)": r.volume.toFixed(0),
    fills: r.fills.length,
    requotes: r.requotes,
    "gas (USD₮)": r.gasSpent.toFixed(3),
    "max DD": r.maxDrawdown.toFixed(3),
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

async function loadPrices(data: string, pair: string, days: number, seed: number): Promise<PricePoint[]> {
  if (data === "history") {
    if (!PAIRS.includes(pair as PairId)) throw new Error(`unknown pair ${pair}`);
    return fetchCoinGeckoHistory(COINGECKO_IDS[pair as PairId], days);
  }
  if (data in SCENARIOS) {
    return syntheticPrices({ ...SCENARIOS[data as Scenario], steps: days * 24, rng: createRng(seed) });
  }
  throw new Error(`--data must be "history" or one of: ${Object.keys(SCENARIOS).join(", ")}`);
}
