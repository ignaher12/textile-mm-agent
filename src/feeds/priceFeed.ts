import {
  aggregate,
  type AggregateOptions,
  type ReferencePrice,
  type Rejection,
} from "./aggregate.js";
import type { PriceQuote, PriceSource } from "./types.js";

export interface PriceFeedOptions extends Omit<AggregateOptions, "now"> {
  sources: readonly PriceSource[];
  timeoutMs: number;
  now?: () => number;
}

export interface PriceFeed {
  get(): Promise<ReferencePrice>;
}

/** Queries every source in parallel and aggregates whatever comes back in time. */
export function createPriceFeed(opts: PriceFeedOptions): PriceFeed {
  const { sources, timeoutMs, now = Date.now, ...aggregateOpts } = opts;

  return {
    async get() {
      const results = await Promise.allSettled(
        sources.map((s) => s.fetch(AbortSignal.timeout(timeoutMs))),
      );

      const quotes: PriceQuote[] = [];
      const failures: Rejection[] = [];
      results.forEach((result, i) => {
        if (result.status === "fulfilled") quotes.push(result.value);
        else failures.push({ source: sources[i]!.name, reason: errorMessage(result.reason) });
      });

      return aggregate(quotes, failures, { ...aggregateOpts, now: now() });
    },
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
