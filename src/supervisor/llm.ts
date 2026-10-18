import { z } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

const completionSchema = z.object({
  choices: z
    .array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string().nullable() }) }))
    .min(1),
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
  /** Reasoning models spend part of this thinking before they answer, so keep it roomy. */
  maxTokens?: number;
}): ChatFn {
  const { baseUrl, apiKey, model, timeoutMs = 240_000, temperature = 0.2, maxTokens = 16_384 } = opts;
  return async (messages) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const choice = completionSchema.parse(await res.json()).choices[0]!;
    if (!choice.message.content) {
      throw new Error(
        choice.finish_reason === "length"
          ? `LLM ran out of tokens before answering (max_tokens ${maxTokens}; reasoning models think first)`
          : "LLM returned an empty message",
      );
    }
    return choice.message.content;
  };
}
