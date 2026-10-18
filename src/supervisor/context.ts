import type { QuoteParams } from "../engine/params.js";
import type { MarketSnapshot } from "../textile/market.js";

/** Everything the supervisor sees on one run, already summarized into plain numbers. */
export interface SupervisorContext {
  time: string;
  pair: string;
  /** Our reference, local currency per USD₮. */
  refPrice: number;
  /** Reference change over each window, as a fraction (null without enough history). */
  moves: { m10: number | null; h1: number | null; h6: number | null };
  inventory: { usdt: number; local: number; usdtShare: number; navUsdt: number };
  drawdown: number;
  risk: { paused: boolean; reasons: string[]; killed: string | null };
  market: MarketSnapshot | null;
  stitchSpreadBpsPerSide: number;
  fillsLast24h: number | null;
  params: { targetBaseShare: number; maxSkewBps: number; inventoryBand: number; paused: boolean; skewCapBps: number };
  recentDecisions: { time: string; reason: string }[];
}

/** Keeps a few hours of reference prices to measure moves over fixed windows. */
export function createPriceHistory(maxAgeMs = 6 * 3600_000) {
  let points: { t: number; price: number }[] = [];
  return {
    add(t: number, price: number) {
      points = [...points.filter((p) => t - p.t <= maxAgeMs), { t, price }];
    },
    /** Change from the oldest point at least `windowMs` old to the latest. */
    move(windowMs: number, now: number): number | null {
      const latest = points.at(-1);
      const base = points.filter((p) => now - p.t >= windowMs).at(-1);
      return latest && base ? latest.price / base.price - 1 : null;
    },
  };
}

export function paramsView(p: QuoteParams): SupervisorContext["params"] {
  return {
    targetBaseShare: p.targetBaseShare,
    maxSkewBps: p.maxSkew * 1e4,
    inventoryBand: p.inventoryBand,
    paused: p.paused,
    // The engine caps skew at a quarter of the full spread, whatever maxSkew says.
    skewCapBps: Math.min(p.maxSkew, p.spread / 4) * 1e4,
  };
}
