import { z } from "zod";
import { median } from "../../lib/stats.js";
import { fetchJson } from "../http.js";
import type { FetchFn, PriceSource } from "../types.js";

const responseSchema = z.record(z.string(), z.unknown());
const exchangeSchema = z.object({
  ask: z.number().positive(),
  bid: z.number().positive(),
  time: z.number(),
});

/**
 * USD₮ price across the exchanges CriptoYa tracks. Each exchange contributes
 * its mid price; the source reports the median of fresh, uncrossed books.
 */
export function criptoYaSource(opts: {
  fiat: "ars" | "brl";
  fetchFn?: FetchFn;
  maxExchangeAgeMs?: number;
  minExchanges?: number;
  now?: () => number;
}): PriceSource {
  const {
    fiat,
    fetchFn = fetch,
    maxExchangeAgeMs = 10 * 60_000,
    minExchanges = 3,
    now = Date.now,
  } = opts;
  const name = `criptoya:usdt/${fiat}`;
  const url = `https://criptoya.com/api/usdt/${fiat}/1`;

  return {
    name,
    async fetch(signal) {
      const data = await fetchJson(fetchFn, url, responseSchema, signal);
      const fresh = Object.values(data)
        .map((entry) => exchangeSchema.safeParse(entry))
        .filter((r) => r.success)
        .map((r) => r.data)
        .filter((e) => e.ask >= e.bid && now() - e.time * 1000 <= maxExchangeAgeMs);

      if (fresh.length < minExchanges) {
        throw new Error(`only ${fresh.length} fresh exchanges on CriptoYa (need ${minExchanges})`);
      }
      return {
        source: name,
        price: median(fresh.map((e) => (e.ask + e.bid) / 2)),
        timestamp: median(fresh.map((e) => e.time * 1000)),
      };
    },
  };
}
