// Generates the agent's wallet and stores its private key in .env.
// The key is never printed. Refuses to run if a key is already set.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ENV_FILE } from "../src/config/env.js";

if (!existsSync(ENV_FILE)) {
  console.error(`No ${ENV_FILE} found. Copy .env.example to ${ENV_FILE} first.`);
  process.exit(1);
}

const content = readFileSync(ENV_FILE, "utf8");
const line = /^PRIVATE_KEY=(.*)$/m;
const existing = content.match(line)?.[1]?.trim();

if (existing) {
  const address = privateKeyToAccount(existing as `0x${string}`).address;
  console.error(
    `PRIVATE_KEY is already set in ${ENV_FILE} (address ${address}).\n` +
      `Refusing to overwrite it: that would lose access to any funds it holds.`,
  );
  process.exit(1);
}

const key = generatePrivateKey();
const { address } = privateKeyToAccount(key);
const updated = line.test(content)
  ? content.replace(line, `PRIVATE_KEY=${key}`)
  : `${content.trimEnd()}\nPRIVATE_KEY=${key}\n`;
writeFileSync(ENV_FILE, updated);

console.log(`
✅ Agent wallet created. Private key saved to ${ENV_FILE}.

   Address: ${address}

Next steps:
  1. Back up the private key (from ${ENV_FILE}) in a password manager.
     If ${ENV_FILE} is lost, the funds in this wallet are lost.
  2. Send the faucet USD₮ to the address above (Celo mainnet).
  3. Check it arrived:  npm run balances

Never commit ${ENV_FILE} or share the private key.
`);
