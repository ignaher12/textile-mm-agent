import { median } from "../lib/stats.js";
import type { PriceQuote } from "./types.js";

export interface AggregateOptions {
  now: number;
  /** Quotes older than this are discarded. */
  maxAgeMs: number;
  /** Quotes deviating more than this fraction from the median are discarded. */
  maxDeviation: number;
  /** Minimum number of agreeing sources required to produce a price. */
  minSources: number;
}

export interface Rejection {
  source: string;
  reason: string;
}

export type ReferencePrice =
  | { ok: true; price: number; timestamp: number; used: PriceQuote[]; rejected: Rejection[] }
  | { ok: false; reason: string; used: PriceQuote[]; rejected: Rejection[] };

/**
 * Combines independent price quotes into a single reference price:
 * drop invalid and stale quotes, drop outliers against the median,
 * then take the median of what remains.
 */
export function aggregate(
  quotes: readonly PriceQuote[],
  priorRejections: readonly Rejection[],
  opts: AggregateOptions,
): ReferencePrice {
  const rejected: Rejection[] = [...priorRejections];

  const fresh = quotes.filter((q) => {
    if (!Number.isFinite(q.price) || q.price <= 0) {
      rejected.push({ source: q.source, reason: `invalid price ${q.price}` });
      return false;
    }
    const age = opts.now - q.timestamp;
    if (age > opts.maxAgeMs) {
      rejected.push({ source: q.source, reason: `stale (${Math.round(age / 1000)}s old)` });
      return false;
    }
    return true;
  });

  if (fresh.length < opts.minSources) {
    return { ok: false, reason: notEnough(fresh.length, opts.minSources), used: fresh, rejected };
  }

  const center = median(fresh.map((q) => q.price));
  const used = fresh.filter((q) => {
    const deviation = Math.abs(q.price - center) / center;
    if (deviation > opts.maxDeviation) {
      rejected.push({
        source: q.source,
        reason: `outlier (${(deviation * 100).toFixed(2)}% off median)`,
      });
      return false;
    }
    return true;
  });

  if (used.length < opts.minSources) {
    return { ok: false, reason: notEnough(used.length, opts.minSources), used, rejected };
  }

  return {
    ok: true,
    price: median(used.map((q) => q.price)),
    // The reference is only as fresh as its oldest input.
    timestamp: Math.min(...used.map((q) => q.timestamp)),
    used,
    rejected,
  };
}

function notEnough(have: number, need: number): string {
  return `only ${have} usable sources (need ${need})`;
}
