import { clamp } from "../lib/stats.js";
import type { QuoteParams } from "./params.js";

/** Balances held by the agent: base is USD₮, quote is the local currency (e.g. wARS). */
export interface Inventory {
  base: number;
  quote: number;
}

export type Side = "bid" | "ask";

/** An order the engine wants resting on the book. Size is in base units (USD₮). */
export interface OrderIntent {
  side: Side;
  price: number;
  size: number;
}

export interface QuoteResult {
  orders: OrderIntent[];
  /** Share of inventory value currently held in USD₮. */
  baseShare: number;
  /** Normalized inventory imbalance in [-1, 1]; positive means too much USD₮. */
  imbalance: number;
  /** Fractional price shift applied to both sides. */
  skew: number;
}

/** Orders smaller than this (in USD₮) are not worth the gas. */
export const MIN_ORDER_SIZE = 1;

/**
 * Computes the bid and ask the agent should quote around a reference price.
 *
 *   bid = ref × (1 − spread/2 − skew)
 *   ask = ref × (1 + spread/2 − skew)
 *
 * Skew is proportional to the inventory imbalance and shifts both prices to
 * attract flow that rebalances the inventory. It is capped at a quarter of the
 * spread, so even the side pulled toward the reference keeps at least
 * spread/4 of edge and never quotes at or through it. At full imbalance the
 * overweight side stops quoting entirely.
 *
 * Pure function: no I/O, so the live agent and the simulator share it.
 */
export function computeQuotes(ref: number, params: QuoteParams, inv: Inventory): QuoteResult {
  const baseValue = inv.base * ref;
  const total = baseValue + inv.quote;
  const baseShare = total > 0 ? baseValue / total : params.targetBaseShare;
  const imbalance = clamp((baseShare - params.targetBaseShare) / params.inventoryBand, -1, 1);

  const half = params.spread / 2;
  const skew = imbalance * Math.min(params.maxSkew, half / 2);

  const result: QuoteResult = { orders: [], baseShare, imbalance, skew };
  if (params.paused || total <= 0) return result;

  const bidPrice = ref * (1 - half - skew);
  const askPrice = ref * (1 + half - skew);

  // Bid: spend local currency to buy USD₮. Skip when already holding too much USD₮.
  const bidSize = Math.min(params.orderSize, inv.quote / bidPrice);
  if (imbalance < 1 && bidSize >= MIN_ORDER_SIZE) {
    result.orders.push({ side: "bid", price: bidPrice, size: bidSize });
  }

  // Ask: sell USD₮ for local currency. Skip when already holding too little USD₮.
  const askSize = Math.min(params.orderSize, inv.base);
  if (imbalance > -1 && askSize >= MIN_ORDER_SIZE) {
    result.orders.push({ side: "ask", price: askPrice, size: askSize });
  }

  return result;
}
