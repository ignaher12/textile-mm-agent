import type { z } from "zod";
import type { FetchFn } from "./types.js";

export async function fetchJson<T extends z.ZodType>(
  fetchFn: FetchFn,
  url: string,
  schema: T,
  signal: AbortSignal,
): Promise<z.output<T>> {
  const res = await fetchFn(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return schema.parse(await res.json());
}
