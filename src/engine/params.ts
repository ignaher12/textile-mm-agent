import { z } from "zod";
import { clamp } from "../lib/stats.js";

/**
 * Strategy parameters. The supervisor proposes them; the bounds below are the
 * hard limits nothing can override.
 */
export const quoteParamsSchema = z.object({
  /** Full bid-ask width as a fraction of the reference price (0.02 = 2%). */
  spread: z.number(),
  /** Target order size, in USD₮. */
  orderSize: z.number(),
  /** Max price shift at full inventory imbalance, as a fraction of the reference. */
  maxSkew: z.number(),
  /** Desired share of inventory value held in USD₮ (0.5 = balanced). */
  targetBaseShare: z.number(),
  /** Deviation from target at which the overweight side stops being added to. */
  inventoryBand: z.number(),
  /** When true the engine quotes nothing. */
  paused: z.boolean(),
});

export type QuoteParams = z.infer<typeof quoteParamsSchema>;

type NumericParam = { [K in keyof QuoteParams]: QuoteParams[K] extends number ? K : never }[keyof QuoteParams];

export const PARAM_BOUNDS: Record<NumericParam, { min: number; max: number }> = {
  // Textile spreads live in basis points: 2 bps full width (1 bps per side) up to 10%.
  spread: { min: 0.0002, max: 0.1 },
  orderSize: { min: 1, max: 500 },
  maxSkew: { min: 0, max: 0.05 },
  targetBaseShare: { min: 0.1, max: 0.9 },
  inventoryBand: { min: 0.05, max: 0.45 },
};

/**
 * With Stitch as the execution layer, `spread` must mirror stitch.toml
 * (buy_offset_bps + sell_offset_bps): Stitch applies the spread, and we only
 * use it here to cap the skew we publish through the feed.
 */
export const DEFAULT_PARAMS: QuoteParams = {
  spread: 0.004,
  orderSize: 10,
  maxSkew: 0.01,
  targetBaseShare: 0.5,
  inventoryBand: 0.35,
  paused: false,
};

/** Forces every numeric parameter into its allowed range. */
export function clampParams(params: QuoteParams): QuoteParams {
  const clamped = { ...params };
  for (const key of Object.keys(PARAM_BOUNDS) as NumericParam[]) {
    const { min, max } = PARAM_BOUNDS[key];
    clamped[key] = clamp(params[key], min, max);
  }
  return clamped;
}
