import { z } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

/**
 * Minimal client for any OpenAI-compatible chat completions API (NVIDIA
 * Build by default). Plain fetch: the supervisor makes a few calls an hour and
 * needs nothing an SDK adds.
 */
export function createChat(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  temperature?: number;
}): ChatFn {
  const { baseUrl, apiKey, model, timeoutMs = 60_000, temperature = 0.2 } = opts;
  return async (messages) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature, max_tokens: 800 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const content = completionSchema.parse(await res.json()).choices[0]!.message.content;
    if (!content) throw new Error("LLM returned an empty message");
    return content;
  };
}
