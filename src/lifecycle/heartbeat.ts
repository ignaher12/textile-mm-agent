import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const pairHealthSchema = z.object({
  quoting: z.boolean(),
  reasons: z.array(z.string()),
  ref: z.number().nullable(),
  published: z.number().nullable(),
  skewBps: z.number(),
  inventory: z.object({ base: z.number(), quote: z.number() }).nullable(),
  drawdown: z.number(),
  killed: z.string().nullable(),
  lastRefresh: z.number(),
});

export const heartbeatSchema = z.object({
  at: z.number(),
  startedAt: z.number(),
  pid: z.number(),
  state: z.enum(["running", "stopping", "stopped"]),
  stopReason: z.string().nullable(),
  pairs: z.record(z.string(), pairHealthSchema),
});

export type PairHealth = z.infer<typeof pairHealthSchema>;
export type Heartbeat = z.infer<typeof heartbeatSchema>;

/**
 * The agent's last known state, rewritten on every refresh. It is what
 * `/health` serves while the process is up, and what's left on disk after it
 * dies: a heartbeat that stops ageing forward in "running" means a crash or a
 * power cut, not a clean OFF.
 */
export function createHeartbeatFile(path: string) {
  return {
    write(hb: Heartbeat) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(hb, null, 2));
      renameSync(tmp, path);
    },
    read(): Heartbeat | null {
      if (!existsSync(path)) return null;
      const parsed = heartbeatSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
      return parsed.success ? parsed.data : null;
    },
  };
}
