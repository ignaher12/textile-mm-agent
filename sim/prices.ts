import { z } from "zod";
import type { FetchFn } from "../src/feeds/types.js";
import { gaussian, type Rng } from "./rng.js";

/** A reference price (local currency per USD₮) at a Unix-millisecond timestamp. */
export interface PricePoint {
  t: number;
  price: number;
}

const marketChartSchema = z.object({
  prices: z.array(z.tuple([z.number(), z.number().positive()])),
});

/**
 * Hourly history from CoinGecko (hourly granularity for 2–90 days).
 * Prices are inverted from USD per token to tokens per USD₮.
 */
export async function fetchCoinGeckoHistory(
  coinId: string,
  days: number,
  fetchFn: FetchFn = fetch,
): Promise<PricePoint[]> {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
  const res = await fetchFn(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const { prices } = marketChartSchema.parse(await res.json());
  return prices.map(([t, usd]) => ({ t, price: 1 / usd }));
}

export interface SyntheticOptions {
  start: number;
  steps: number;
  stepMs: number;
  /** Std-dev of log returns per step (0.001 = 0.1%). */
  volatility: number;
  /** Mean log return per step; positive means the local currency depreciates. */
  drift: number;
  /** Probability per step of a devaluation jump. */
  jumpProbability: number;
  /** Size of each jump as a log return (0.05 ≈ +5%). */
  jumpSize: number;
  rng: Rng;
}

/** Geometric random walk with optional devaluation jumps. */
export function syntheticPrices(opts: SyntheticOptions): PricePoint[] {
  const points: PricePoint[] = [{ t: 0, price: opts.start }];
  let price = opts.start;
  for (let i = 1; i < opts.steps; i++) {
    let logReturn = opts.drift + opts.volatility * gaussian(opts.rng);
    if (opts.rng() < opts.jumpProbability) logReturn += opts.jumpSize;
    price *= Math.exp(logReturn);
    points.push({ t: i * opts.stepMs, price });
  }
  return points;
}

export type Scenario = "calm" | "volatile" | "devaluation";

/** Preset hourly scenarios starting near today's USD₮/ARS price. */
export const SCENARIOS: Record<Scenario, Omit<SyntheticOptions, "steps" | "rng">> = {
  calm: { start: 1600, stepMs: 3_600_000, volatility: 0.001, drift: 0, jumpProbability: 0, jumpSize: 0 },
  volatile: { start: 1600, stepMs: 3_600_000, volatility: 0.004, drift: 0, jumpProbability: 0, jumpSize: 0 },
  devaluation: {
    start: 1600,
    stepMs: 3_600_000,
    volatility: 0.002,
    drift: 0.0002,
    jumpProbability: 0.005,
    jumpSize: 0.05,
  },
};
