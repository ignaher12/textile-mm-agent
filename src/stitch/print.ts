import type { ReferencePrice } from "../feeds/aggregate.js";
import type { PairId } from "../feeds/pairs.js";

/**
 * What Stitch reads from its feed URL. `price` is debt per collateral (USD₮ per
 * wARS), `timestamp` is integer Unix seconds and never in the future, and
 * `degraded: true` makes Stitch quote nothing off the print.
 */
export interface StitchPrint {
  price: number;
  timestamp: number;
  degraded: boolean;
}

/** Stitch's pair slugs, mapped to our pairs. */
export const STITCH_PAIRS: Record<string, PairId> = {
  "wars-usdt": "USDT/ARS",
  "wbrl-usdt": "USDT/BRL",
};

/** Adjustments the agent applies on top of the reference before Stitch sees it. */
export interface PrintAdjustment {
  /** Inventory skew from `computeQuotes`, as a fraction of the reference. */
  skew: number;
  /** When true the print is flagged degraded, so Stitch stops quoting. */
  paused: boolean;
}

/**
 * Turns our reference price into a Stitch feed print.
 *
 * Stitch spreads its bid and ask symmetrically around the print and has no
 * inventory lean on RFQ, so we publish the skewed center instead:
 * ref × (1 − skew) is exactly the midpoint of the engine's bid and ask. Our
 * reference is local currency per USD₮, Stitch wants the inverse.
 *
 * Returns null when there is no trustworthy price: the server then fails the
 * request, and Stitch drops its cached print and quotes nothing.
 */
export function toStitchPrint(
  ref: ReferencePrice,
  adj: PrintAdjustment,
  nowMs: number,
): StitchPrint | null {
  if (!ref.ok) return null;
  const center = ref.price * (1 - adj.skew);
  return {
    price: 1 / center,
    // Stitch rejects timestamps ahead of its clock, even by one second.
    timestamp: Math.floor(Math.min(ref.timestamp, nowMs) / 1000),
    degraded: adj.paused,
  };
}
