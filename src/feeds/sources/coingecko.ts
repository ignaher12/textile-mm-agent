import { z } from "zod";
import { fetchJson } from "../http.js";
import type { FetchFn, PriceSource } from "../types.js";

const responseSchema = z.record(
  z.string(),
  z.object({ usd: z.number().positive(), last_updated_at: z.number() }),
);

/**
 * CoinGecko token price. CoinGecko quotes the token in USD, so the price per
 * USD₮ is the inverse (USD₮ ≈ USD). For wARS use coinId "argentine-peso".
 */
export function coinGeckoSource(opts: { coinId: string; fetchFn?: FetchFn }): PriceSource {
  const { coinId, fetchFn = fetch } = opts;
  const name = `coingecko:${coinId}`;
  const url =
    `https://api.coingecko.com/api/v3/simple/price` +
    `?ids=${coinId}&vs_currencies=usd&include_last_updated_at=true`;

  return {
    name,
    async fetch(signal) {
      const data = await fetchJson(fetchFn, url, responseSchema, signal);
      const entry = data[coinId];
      if (!entry) throw new Error(`${coinId} missing from CoinGecko response`);
      return { source: name, price: 1 / entry.usd, timestamp: entry.last_updated_at * 1000 };
    },
  };
}
