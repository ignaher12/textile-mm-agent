import { existsSync } from "node:fs";
import { z } from "zod";

export const ENV_FILE = ".env";

/** Empty `KEY=` lines in .env mean "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const envSchema = z.object({
  PRIVATE_KEY: optional(
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key")
      .transform((v) => v as `0x${string}`),
  ),
  CELO_RPC_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().default("https://forno.celo.org")),
  ATTRIBUTION_TAG: optional(
    z.string().regex(/^[a-z0-9_]{1,32}$/, "must be 1-32 chars of [a-z0-9_]"),
  ),
  // LLM supervisor (any OpenAI-compatible API). Without a key it stays off.
  LLM_BASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().default("https://integrate.api.nvidia.com/v1")),
  LLM_API_KEY: optional(z.string()),
  LLM_MODEL: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("meta/llama-3.3-70b-instruct")),
  TELEGRAM_BOT_TOKEN: optional(z.string()),
  TELEGRAM_CHAT_ID: optional(z.string()),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${issues.join("\n")}`);
  }
  return result.data;
}

/** Loads .env (if present) into process.env and validates it. */
export function loadEnv(path = ENV_FILE): Env {
  if (existsSync(path)) process.loadEnvFile(path);
  return parseEnv(process.env);
}

export function required<K extends keyof Env>(env: Env, key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined) throw new Error(`${key} is not set in ${ENV_FILE}`);
  return value as NonNullable<Env[K]>;
}
