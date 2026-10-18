import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const probeSchema = z.union([z.object({ bps: z.number(), depthUsdt: z.number() }), z.object({ error: z.string() })]);

export const metricSchema = z.object({
  t: z.number(),
  quoting: z.boolean(),
  reasons: z.array(z.string()),
  /** Our reference, local currency per USD₮. */
  ref: z.number().nullable(),
  skewBps: z.number(),
  usdt: z.number().nullable(),
  local: z.number().nullable(),
  /** Inventory value in USD₮ at `ref`. */
  navUsdt: z.number().nullable(),
  /** Our live quote and the best market quote, per direction (null when the probe failed). */
  market: z
    .object({
      traderSellsWars: z.object({ ours: probeSchema, best: probeSchema }),
      traderBuysWars: z.object({ ours: probeSchema, best: probeSchema }),
    })
    .nullable(),
});

export type Metric = z.infer<typeof metricSchema>;

/** Append-only time series of the agent's state: the raw material for the evidence report. */
export function createMetricsLog(path: string) {
  return {
    append(m: Metric) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(m) + "\n");
    },
    read(): Metric[] {
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          const parsed = metricSchema.safeParse(JSON.parse(line));
          return parsed.success ? [parsed.data] : [];
        });
    },
  };
}
