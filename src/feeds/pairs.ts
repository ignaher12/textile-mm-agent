import { createPriceFeed, type PriceFeed } from "./priceFeed.js";
import { coinGeckoSource } from "./sources/coingecko.js";
import { criptoYaSource } from "./sources/criptoya.js";
import { dolarApiSource } from "./sources/dolarapi.js";
import { textileSource } from "./sources/textile.js";
import type { FetchFn } from "./types.js";

export type PairId = "USDT/ARS" | "USDT/BRL";

export const PAIRS: readonly PairId[] = ["USDT/ARS", "USDT/BRL"];

/** CoinGecko ids of the Ripio wFiat tokens, used for live and historical prices. */
export const COINGECKO_IDS: Record<PairId, string> = {
  "USDT/ARS": "argentine-peso",
  "USDT/BRL": "brazilian-real",
};

export const FEED_DEFAULTS = {
  timeoutMs: 5_000,
  maxAgeMs: 30 * 60_000,
  maxDeviation: 0.03,
} as const;

export function createPairFeed(
  pair: PairId,
  fetchFn: FetchFn = fetch,
  overrides: Partial<typeof FEED_DEFAULTS> = {},
): PriceFeed {
  const defaults = { ...FEED_DEFAULTS, ...overrides };
  switch (pair) {
    case "USDT/ARS":
      return createPriceFeed({
        ...defaults,
        minSources: 2,
        sources: [
          coinGeckoSource({ coinId: COINGECKO_IDS[pair], fetchFn }),
          criptoYaSource({ fiat: "ars", fetchFn }),
          dolarApiSource({ fetchFn }),
          textileSource({ pair: "wars-usdt", fetchFn }),
        ],
      });
    case "USDT/BRL":
      return createPriceFeed({
        ...defaults,
        minSources: 2,
        sources: [
          coinGeckoSource({ coinId: COINGECKO_IDS[pair], fetchFn }),
          criptoYaSource({ fiat: "brl", fetchFn }),
          textileSource({ pair: "wbrl-usdt", fetchFn }),
        ],
      });
  }
}
