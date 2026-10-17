// Registers the agent's ERC-8004 identity on Celo mainnet. Gas is paid in USD₮.
//
//   npm run identity -- --repo https://github.com/<user>/textile-mm-agent          # dry run
//   npm run identity -- --repo https://github.com/<user>/textile-mm-agent --send   # for real
import { parseArgs } from "node:util";
import { formatEther, parseEventLogs } from "viem";
import { USDT_FEE_CURRENCY, createCeloClient } from "../src/chain/celo.js";
import { createAgentWallet } from "../src/chain/wallet.js";
import { loadEnv } from "../src/config/env.js";
import {
  IDENTITY_REGISTRY,
  buildAgentMetadata,
  identityRegistryAbi,
  toDataUri,
} from "../src/identity/erc8004.js";

const { values: args } = parseArgs({
  options: { repo: { type: "string" }, send: { type: "boolean", default: false } },
});
if (!args.repo?.startsWith("https://github.com/")) {
  console.error("Pass the public repo URL: --repo https://github.com/<user>/textile-mm-agent");
  process.exit(1);
}

const env = loadEnv();
const { account, client: wallet } = createAgentWallet(env);
const publicClient = createCeloClient(env.CELO_RPC_URL);

const owned = await publicClient.readContract({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  functionName: "balanceOf",
  args: [account.address],
});
if (owned > 0n) {
  console.error(`${account.address} already owns ${owned} ERC-8004 identity. Not registering again.`);
  process.exit(1);
}

const metadata = buildAgentMetadata(args.repo);
const agentURI = toDataUri(metadata);

const { result: predictedId } = await publicClient.simulateContract({
  account: account.address,
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  functionName: "register",
  args: [agentURI],
});
const gas = await publicClient.estimateContractGas({
  account: account.address,
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  functionName: "register",
  args: [agentURI],
});
const gasPrice = await publicClient.getGasPrice();

console.log("\nERC-8004 registration");
console.log(`  Owner / agent wallet: ${account.address}`);
console.log(`  Registry:             ${IDENTITY_REGISTRY}`);
console.log(`  Predicted agentId:    ${predictedId}`);
console.log(`  Estimated gas:        ${gas} (~${formatEther(gas * gasPrice)} CELO-equivalent, paid in USD₮)`);
console.log(`  Metadata:\n${JSON.stringify(metadata, null, 2).replace(/^/gm, "    ")}`);

if (!args.send) {
  console.log("\nDry run only. Re-run with --send to register for real.");
  process.exit(0);
}

const hash = await wallet.writeContract({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  functionName: "register",
  args: [agentURI],
  feeCurrency: USDT_FEE_CURRENCY,
});
console.log(`\nSent: https://celoscan.io/tx/${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`registration reverted: ${hash}`);

const [mint] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Transfer", logs: receipt.logs });
console.log(`✅ Registered. agentId = ${mint?.args.tokenId ?? predictedId}`);
console.log(`   Check it on https://8004scan.io (search ${account.address})`);
