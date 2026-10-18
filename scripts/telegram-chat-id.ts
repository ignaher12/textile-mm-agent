// Finds your Telegram chat id: send any message to your bot first, then run
//
//   npm run telegram:chat-id
//
// and copy the id it prints into TELEGRAM_CHAT_ID in .env.
import { z } from "zod";
import { loadEnv, required } from "../src/config/env.js";

const schema = z.object({
  ok: z.boolean(),
  result: z.array(
    z.object({
      message: z
        .object({
          chat: z.object({ id: z.number(), type: z.string(), username: z.string().optional(), first_name: z.string().optional() }),
          text: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

async function main() {
  const token = required(loadEnv(), "TELEGRAM_BOT_TOKEN");
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const body = schema.parse(await res.json());
  const chats = new Map<number, string>();
  for (const u of body.result) {
    const c = u.message?.chat;
    if (c) chats.set(c.id, `${c.type} ${c.username ? "@" + c.username : (c.first_name ?? "")}`);
  }
  if (chats.size === 0) return console.log("No messages yet. Send any message to your bot in Telegram, then run this again.");
  for (const [id, who] of chats) console.log(`TELEGRAM_CHAT_ID=${id}   (${who})`);
}

await main();
