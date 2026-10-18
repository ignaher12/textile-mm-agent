import { z } from "zod";
import { clampParams, type QuoteParams } from "../engine/params.js";

/**
 * What the supervisor may change. Everything here reaches Stitch through our
 * feed without a restart; Stitch's own spread can't, so it is only a
 * recommendation that gets logged for a human (or a later restart) to act on.
 */
export const decisionSchema = z.object({
  paused: z.boolean(),
  /** Desired share of inventory value held in USD₮, 0.1–0.9. */
  targetBaseShare: z.number(),
  /** Max skew at full imbalance, in basis points. */
  maxSkewBps: z.number(),
  /** Deviation from target at which skew saturates, 0.05–0.45. */
  inventoryBand: z.number(),
  /** Suggested Stitch spread per side, in bps. Logged, not applied. */
  recommendedSpreadBps: z.number().optional(),
  reason: z.string().min(1).max(1000),
});

export type Decision = z.infer<typeof decisionSchema>;

/** Folds a decision into the current params, inside the hard bounds. Spread is never touched. */
export function applyDecision(params: QuoteParams, d: Decision): QuoteParams {
  return clampParams({
    ...params,
    paused: d.paused,
    targetBaseShare: d.targetBaseShare,
    maxSkew: d.maxSkewBps / 1e4,
    inventoryBand: d.inventoryBand,
  });
}

/**
 * Pulls the first JSON object out of a model reply, tolerating code fences
 * and prose around it, then validates it.
 */
export function parseDecision(text: string): Decision {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return decisionSchema.parse(JSON.parse(text.slice(start, end + 1)));
}
