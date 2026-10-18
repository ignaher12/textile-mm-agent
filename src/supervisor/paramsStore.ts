import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { clampParams, quoteParamsSchema, type QuoteParams } from "../engine/params.js";

/**
 * Persists the supervisor's last applied params. Anything unreadable falls
 * back to the defaults (returns undefined), and what loads is clamped again,
 * so a hand-edited file can't push a value past the hard bounds.
 */
export function createParamsStore(path: string) {
  return {
    load(): QuoteParams | undefined {
      if (!existsSync(path)) return undefined;
      try {
        return clampParams(quoteParamsSchema.parse(JSON.parse(readFileSync(path, "utf8"))));
      } catch {
        return undefined;
      }
    },
    save(params: QuoteParams) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(params, null, 2));
      renameSync(tmp, path);
    },
  };
}
