import { computeQuotes, type Inventory, type OrderIntent, type Side } from "../src/engine/quote.js";
import type { QuoteParams } from "../src/engine/params.js";
import type { PricePoint } from "./prices.js";
import { createRng } from "./rng.js";

/**
 * How resting orders get filled. There is no historical Textile order flow
 * yet, so fills come from two assumptions:
 *
 * 1. Crossing (adverse): if the reference moves through our price, an
 *    arbitrageur takes the stale order. These fills lose money.
 * 2. Organic takers: each step, a taker hits each side with probability
 *    `takerRate × e^(−decay × distance%)`, where distance is how far our
 *    price sits from the reference. Wider spread = fewer, better fills.
 */
export interface FillModel {
  takerRate: number;
  decay: number;
}

export interface SimConfig {
  prices: readonly PricePoint[];
  params: QuoteParams;
  initialInventory: Inventory;
  fillModel: FillModel;
  /** Gas cost of one requote (cancel + replace both sides), in USD₮. */
  gasPerRequote: number;
  /** Requote when the reference moves more than this fraction since the last quote. */
  requoteThreshold: number;
  /** Fee charged on each fill as a fraction of notional. */
  feeRate: number;
  seed: number;
}

export interface SimFill {
  t: number;
  side: Side;
  price: number;
  size: number;
  kind: "crossing" | "organic";
}

export interface SimResult {
  startEquity: number;
  endEquity: number;
  /** Equity if the initial inventory had simply been held. */
  holdEquity: number;
  /** Mark-to-market P&L in USD₮, net of gas and fees. */
  pnl: number;
  pnlPct: number;
  /** P&L relative to holding the initial inventory. */
  alpha: number;
  volume: number;
  fills: SimFill[];
  requotes: number;
  gasSpent: number;
  maxDrawdown: number;
  finalInventory: Inventory;
  equityCurve: { t: number; equity: number }[];
}

/** Equity in USD₮: base plus local currency converted at the given price. */
export function equity(inv: Inventory, price: number): number {
  return inv.base + inv.quote / price;
}

export function runSimulation(cfg: SimConfig): SimResult {
  const { prices, params, fillModel } = cfg;
  if (prices.length < 2) throw new Error("need at least two price points");

  const rng = createRng(cfg.seed);
  const inv: Inventory = { ...cfg.initialInventory };
  const fills: SimFill[] = [];
  const equityCurve: SimResult["equityCurve"] = [];
  let resting: OrderIntent[] = [];
  let lastQuotedRef = Number.NaN;
  let needsRequote = true;
  let requotes = 0;
  let gasSpent = 0;
  let peak = -Infinity;
  let maxDrawdown = 0;

  const first = prices[0]!;
  const last = prices[prices.length - 1]!;
  const startEquity = equity(inv, first.price);

  for (let i = 0; i < prices.length - 1; i++) {
    const ref = prices[i]!.price;
    const next = prices[i + 1]!;

    if (needsRequote || Math.abs(ref - lastQuotedRef) / lastQuotedRef > cfg.requoteThreshold) {
      resting = computeQuotes(ref, params, inv).orders;
      lastQuotedRef = ref;
      needsRequote = false;
      if (resting.length > 0) {
        requotes++;
        gasSpent += cfg.gasPerRequote;
      }
    }

    const stillResting: OrderIntent[] = [];
    for (const order of resting) {
      const kind = fillKind(order, ref, next.price, fillModel, rng());
      if (!kind) {
        stillResting.push(order);
        continue;
      }
      const notional = order.size * order.price;
      const fee = notional * cfg.feeRate;
      if (order.side === "bid") {
        inv.base += order.size;
        inv.quote -= notional + fee;
      } else {
        inv.base -= order.size;
        inv.quote += notional - fee;
      }
      fills.push({ t: next.t, side: order.side, price: order.price, size: order.size, kind });
      needsRequote = true;
    }
    resting = stillResting;

    const eq = equity(inv, next.price) - gasSpent;
    equityCurve.push({ t: next.t, equity: eq });
    peak = Math.max(peak, eq);
    maxDrawdown = Math.max(maxDrawdown, peak - eq);
  }

  const endEquity = equity(inv, last.price);
  const pnl = endEquity - gasSpent - startEquity;
  const holdEquity = equity(cfg.initialInventory, last.price);

  return {
    startEquity,
    endEquity,
    holdEquity,
    pnl,
    pnlPct: pnl / startEquity,
    alpha: endEquity - gasSpent - holdEquity,
    volume: fills.reduce((sum, f) => sum + f.size, 0),
    fills,
    requotes,
    gasSpent,
    maxDrawdown,
    finalInventory: inv,
    equityCurve,
  };
}

function fillKind(
  order: OrderIntent,
  ref: number,
  nextPrice: number,
  model: FillModel,
  roll: number,
): SimFill["kind"] | null {
  const crossed = order.side === "bid" ? nextPrice <= order.price : nextPrice >= order.price;
  if (crossed) return "crossing";

  const distancePct = (Math.abs(order.price - ref) / ref) * 100;
  const probability = model.takerRate * Math.exp(-model.decay * distancePct);
  return roll < probability ? "organic" : null;
}
