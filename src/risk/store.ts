import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { RiskSnapshot } from "./riskManager.js";

const snapshotSchema = z.object({ peakNav: z.number().nullable(), killed: z.string().nullable() });

/**
 * Persists the risk snapshot so the kill switch survives restarts. A corrupt
 * file fails closed: it reads as killed, never as a clean slate.
 */
export function createRiskStore(path: string) {
  return {
    load(): RiskSnapshot | undefined {
      if (!existsSync(path)) return undefined;
      try {
        return snapshotSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      } catch {
        return { peakNav: null, killed: `unreadable risk state in ${path}` };
      }
    },

    save(snapshot: RiskSnapshot) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
      renameSync(tmp, path);
    },
  };
}
