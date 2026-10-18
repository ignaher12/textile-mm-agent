// Generates a wallet and stores its private key in .env. The key is never
// printed. Refuses to run if that key is already set.
//
//   npm run wallet:new                          # the agent wallet (PRIVATE_KEY)
//   npm run wallet:new -- --var TEST_TAKER_KEY  # a throwaway wallet for self-test trades
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ENV_FILE } from "../src/config/env.js";

const VARS = ["PRIVATE_KEY", "TEST_TAKER_KEY"] as const;
const { values: args } = parseArgs({ options: { var: { type: "string", default: "PRIVATE_KEY" } } });
const name = args.var as (typeof VARS)[number];
if (!VARS.includes(name)) {
  console.error(`--var must be one of ${VARS.join(", ")}`);
  process.exit(1);
}

if (!existsSync(ENV_FILE)) {
  console.error(`No ${ENV_FILE} found. Copy .env.example to ${ENV_FILE} first.`);
  process.exit(1);
}

const content = readFileSync(ENV_FILE, "utf8");
const line = new RegExp(`^${name}=(.*)$`, "m");
const existing = content.match(line)?.[1]?.trim();

if (existing) {
  const address = privateKeyToAccount(existing as `0x${string}`).address;
  console.error(
    `${name} is already set in ${ENV_FILE} (address ${address}).\n` +
      `Refusing to overwrite it: that would lose access to any funds it holds.`,
  );
  process.exit(1);
}

const key = generatePrivateKey();
const { address } = privateKeyToAccount(key);
const updated = line.test(content) ? content.replace(line, `${name}=${key}`) : `${content.trimEnd()}\n${name}=${key}\n`;
writeFileSync(ENV_FILE, updated);

const what = name === "PRIVATE_KEY" ? "Agent wallet" : "Test taker wallet";
console.log(`
✅ ${what} created. Private key saved to ${ENV_FILE} as ${name}.

   Address: ${address}

Next steps:
  1. Back up the private key (from ${ENV_FILE}) in a password manager.
     If ${ENV_FILE} is lost, the funds in this wallet are lost.
  2. Send USD₮ to the address above (Celo mainnet).
  3. Check it arrived:  npm run balances -- ${address}

Never commit ${ENV_FILE} or share the private key.
`);
