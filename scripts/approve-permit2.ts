// Grants Permit2 a max allowance on a token, so Stitch's signed orders can be
// filled. We do it here instead of `stitch approve` because Stitch can't pay
// gas in USD₮ and its transactions wouldn't carry our attribution tag.
//
//   npm run approve -- --token USDT          # dry run
//   npm run approve -- --token USDT --send   # for real
import { parseArgs } from "node:util";
import { formatEther, formatUnits, maxUint256 } from "viem";
import { PERMIT2, TOKENS, USDT_FEE_CURRENCY, createCeloClient, erc20AllowanceAbi } from "../src/chain/celo.js";
import { createAgentWallet } from "../src/chain/wallet.js";
import { loadEnv } from "../src/config/env.js";

// Early exits return from main() instead of calling process.exit(): exiting
// with sockets still open crashes Node on Windows (libuv UV_HANDLE_CLOSING).
async function main() {
  const { values: args } = parseArgs({
    options: { token: { type: "string" }, send: { type: "boolean", default: false } },
  });
  const token = TOKENS[args.token as keyof typeof TOKENS];
  if (!token) {
    console.error(`Pass --token ${Object.keys(TOKENS).join("|")}`);
    process.exitCode = 1;
    return;
  }

  const env = loadEnv();
  const { account, client: wallet } = createAgentWallet(env);
  const publicClient = createCeloClient(env.CELO_RPC_URL);

  const current = await publicClient.readContract({
    address: token.address,
    abi: erc20AllowanceAbi,
    functionName: "allowance",
    args: [account.address, PERMIT2],
  });
  if (current === maxUint256) {
    console.log(`${token.symbol} already has a max Permit2 allowance. Nothing to do.`);
    return;
  }

  const call = {
    address: token.address,
    abi: erc20AllowanceAbi,
    functionName: "approve",
    args: [PERMIT2, maxUint256],
  } as const;
  await publicClient.simulateContract({ ...call, account: account.address });
  const gas = await publicClient.estimateContractGas({ ...call, account: account.address });
  const gasPrice = await publicClient.getGasPrice();

  console.log(`\nPermit2 approval`);
  console.log(`  Wallet:            ${account.address}`);
  console.log(`  Token:             ${token.symbol} ${token.address}`);
  console.log(`  Spender (Permit2): ${PERMIT2}`);
  console.log(`  Current allowance: ${formatUnits(current, token.decimals)}`);
  console.log(`  New allowance:     max (uint256)`);
  console.log(`  Estimated gas:     ${gas} (~${formatEther(gas * gasPrice)} CELO-equivalent, paid in USD₮)`);

  if (!args.send) {
    console.log("\nDry run only. Re-run with --send to approve for real.");
    return;
  }

  // Sign with the local account: passing a bare address would ask the RPC to sign.
  const hash = await wallet.writeContract({ ...call, account, feeCurrency: USDT_FEE_CURRENCY });
  console.log(`\nSent: https://celoscan.io/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`approval reverted: ${hash}`);
  console.log(`✅ Permit2 can now spend ${token.symbol} on behalf of ${account.address}`);
}

await main();
