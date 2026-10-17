// Prints the agent wallet's Celo mainnet balances.
//   npm run balances              # the agent wallet from .env
//   npm run balances -- 0xabc…    # any address
import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { formatUnits, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKENS, createCeloClient, erc20BalanceAbi } from "../src/chain/celo.js";
import { loadEnv } from "../src/config/env.js";

const env = loadEnv();
const arg = process.argv[2];

let address: Address;
if (arg) {
  if (!isAddress(arg)) throw new Error(`not an address: ${arg}`);
  address = arg;
} else if (env.PRIVATE_KEY) {
  address = privateKeyToAccount(env.PRIVATE_KEY).address;
} else {
  console.error("No PRIVATE_KEY in .env. Run `npm run wallet:new` or pass an address.");
  process.exit(1);
}

const client = createCeloClient(env.CELO_RPC_URL);
const tokens = Object.values(TOKENS);
const [native, ...tokenBalances] = await Promise.all([
  client.getBalance({ address }),
  ...tokens.map((t) =>
    client.readContract({ address: t.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [address] }),
  ),
]);

console.log(`\nCelo mainnet · ${address}`);
console.log(`https://celoscan.io/address/${address}\n`);
console.log(`  ${"CELO".padEnd(6)} ${formatUnits(native, 18)}`);
tokens.forEach((t, i) => console.log(`  ${t.symbol.padEnd(6)} ${formatUnits(tokenBalances[i]!, t.decimals)}`));

if (env.ATTRIBUTION_TAG) {
  const decoded = fromDataSuffix(toDataSuffix(env.ATTRIBUTION_TAG));
  console.log(`\n  Attribution tag: ${env.ATTRIBUTION_TAG} ${decoded ? "✓ encodes correctly" : "✗ failed to encode"}`);
} else {
  console.log("\n  Attribution tag: ✗ ATTRIBUTION_TAG not set in .env");
}
