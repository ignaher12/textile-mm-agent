import { z } from "zod";

const updatesSchema = z.object({
  ok: z.literal(true),
  result: z.array(
    z.object({
      update_id: z.number(),
      message: z.object({ chat: z.object({ id: z.number() }), text: z.string().optional() }).optional(),
    }),
  ),
});

/** Long-poll length Telegram holds each getUpdates open for. */
const POLL_SECS = 30;

export interface Telegram {
  send(text: string): Promise<void>;
  /** Long-polls for messages from the configured chat until `stop()` is called. */
  listen(onText: (text: string) => Promise<string | null>): void;
  stop(): void;
}

/**
 * Minimal Telegram Bot API client over fetch. Messages from any chat other
 * than `chatId` are ignored: the bot can pause and stop the agent, so it only
 * ever answers its owner.
 */
export function createTelegram(opts: { token: string; chatId: string; log?: (msg: string) => void }): Telegram {
  const api = (method: string) => `https://api.telegram.org/bot${opts.token}/${method}`;
  const log = opts.log ?? console.error;
  let running = false;
  let abort: AbortController | null = null;

  async function send(text: string) {
    const res = await fetch(api("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: opts.chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Telegram sendMessage HTTP ${res.status}`);
  }

  async function loop(onText: (text: string) => Promise<string | null>) {
    let offset = 0;
    while (running) {
      try {
        abort = new AbortController();
        // Our own deadline on top of Telegram's 30 s: after the host sleeps, the old
        // socket is dead and the request would otherwise hang forever.
        const res = await fetch(api(`getUpdates?timeout=${POLL_SECS}&offset=${offset}`), {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout((POLL_SECS + 15) * 1000)]),
        });
        const { result } = updatesSchema.parse(await res.json());
        for (const u of result) {
          offset = u.update_id + 1;
          if (!u.message?.text || String(u.message.chat.id) !== opts.chatId) continue;
          const reply = await onText(u.message.text.trim());
          if (reply) await send(reply).catch((e) => log(`telegram reply failed: ${e}`));
        }
      } catch (err) {
        if (!running) return;
        log(`telegram poll failed: ${err instanceof Error ? err.message : err}`);
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  }

  return {
    send,
    listen(onText) {
      if (running) return;
      running = true;
      void loop(onText);
    },
    stop() {
      running = false;
      abort?.abort();
    },
  };
}
