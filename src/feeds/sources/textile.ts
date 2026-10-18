import { z } from "zod";
import { fetchJson } from "../http.js";
import type { FetchFn, PriceSource } from "../types.js";

const responseSchema = z.object({ price: z.number().positive(), timestamp: z.number().int() });

/**
 * Textile's own price endpoint (the default feed Stitch ships with). It quotes
 * USD₮ per token (e.g. ~0.00062 USD₮ per wARS), so the price per USD₮ is the
 * inverse. Timestamps come in Unix seconds.
 */
export function textileSource(opts: {
  pair: "wars-usdt" | "wbrl-usdt";
  chainId?: number;
  fetchFn?: FetchFn;
}): PriceSource {
  const { pair, chainId = 42220, fetchFn = fetch } = opts;
  const name = `textile:${pair}`;
  const url = `https://api.textilecredit.com/price?chainId=${chainId}&pair=${pair}`;

  return {
    name,
    async fetch(signal) {
      const data = await fetchJson(fetchFn, url, responseSchema, signal);
      return { source: name, price: 1 / data.price, timestamp: data.timestamp * 1000 };
    },
  };
}
