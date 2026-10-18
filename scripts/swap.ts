// Trades on Textile as a taker from the agent wallet: RFQ for a firm quote,
// then approve + swap, both sent by us, so both carry our attribution tag and
// pay gas in USD₮. Used to rebalance inventory (e.g. buy wARS so the agent can
// quote both sides).
//
//   npm run swap -- --sell USDT --amount 2.4          # dry run: indicative preview only
//   npm run swap -- --sell USDT --amount 2.4 --send   # firm quote, approve if needed, swap
import { parseArgs } from "node:util";
import { formatUnits, parseUnits, type Hex } from "viem";
import { TOKENS, USDT_FEE_CURRENCY, createCeloClient, erc20AllowanceAbi, erc20BalanceAbi } from "../src/chain/celo.js";
import { createAgentWallet } from "../src/chain/wallet.js";
import { loadEnv } from "../src/config/env.js";
import { previewRfq } from "../src/textile/rfq.js";
import { requestFirmQuote, signTakerProof, submitRfqTx } from "../src/textile/taker.js";

const CHAIN_ID = 42220;
/** Refuse quotes worse than this vs the indicative preview taken just before. */
const MAX_SLIPPAGE = 0.002;

async function main() {
  const { values: args } = parseArgs({
    options: { sell: { type: "string" }, amount: { type: "string" }, send: { type: "boolean", default: false } },
  });
  const pairs = { USDT: [TOKENS.USDT, TOKENS.wARS], wARS: [TOKENS.wARS, TOKENS.USDT] } as const;
  const pair = pairs[args.sell as keyof typeof pairs];
  if (!pair || !args.amount) {
    console.error("Usage: npm run swap -- --sell USDT|wARS --amount <tokens> [--send]");
    process.exitCode = 1;
    return;
  }
  const [sell, buy] = pair;
  const sellAmount = parseUnits(args.amount, sell.decimals);

  const env = loadEnv();
  const { account, client: wallet } = createAgentWallet(env);
  const publicClient = createCeloClient(env.CELO_RPC_URL);

  const balance = await publicClient.readContract({
    address: sell.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [account.address],
  });
  if (balance < sellAmount) throw new Error(`balance ${formatUnits(balance, sell.decimals)} ${sell.symbol} < ${args.amount}`);

  const preview = await previewRfq({ chainId: CHAIN_ID, sellToken: sell.address, buyToken: buy.address, sellAmount });
  if ("error" in preview) throw new Error(`no indicative quote: ${preview.error}`);
  const expected = Number(formatUnits(preview.buyAmount, buy.decimals));
  console.log(`\nTaker swap from ${account.address}`);
  console.log(`  Sell     ${args.amount} ${sell.symbol}`);
  console.log(`  Expect   ~${expected.toFixed(4)} ${buy.symbol}  (rate ${preview.rate.toPrecision(6)} USD₮ per wARS, fee included)`);

  if (!args.send) {
    console.log("\nDry run only (indicative preview, nothing reserved). Re-run with --send to trade.");
    return;
  }

  const takerProof = await signTakerProof(account, CHAIN_ID);
  const q = await requestFirmQuote({
    chainId: CHAIN_ID, sellToken: sell.address, buyToken: buy.address, sellAmount, taker: account.address, takerProof,
  });
  if ("noQuote" in q) throw new Error(`no firm quote: ${q.noQuote}`);

  const firm = Number(formatUnits(BigInt(q.quote.buyAmount), buy.decimals));
  const takerPays = BigInt(q.quote.takerPays);
  console.log(`  Firm     ${firm.toFixed(4)} ${buy.symbol} for ${formatUnits(takerPays, sell.decimals)} ${sell.symbol}, expires ${q.quote.expiresAt}`);
  if (firm < expected * (1 - MAX_SLIPPAGE)) throw new Error(`firm quote ${firm} is > ${MAX_SLIPPAGE * 100}% below the preview ${expected}`);
  if (takerPays > balance) throw new Error("takerPays exceeds balance");

  const spender = q.quote.spender ?? q.quote.reactor;
  const allowance = await publicClient.readContract({
    address: sell.address, abi: erc20AllowanceAbi, functionName: "allowance", args: [account.address, spender],
  });
  const send = async (label: string, tx: { to: `0x${string}`; data: Hex }) => {
    if (Date.parse(q.quote.expiresAt) - Date.now() < 5_000) throw new Error("quote is about to expire, not sending");
    const hash = await wallet.sendTransaction({ account, to: tx.to, data: tx.data, feeCurrency: USDT_FEE_CURRENCY });
    console.log(`  ${label.padEnd(8)} https://celoscan.io/tx/${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    return receipt;
  };

  if (allowance < takerPays) await send("Approve", q.transactions.approval);
  const swap = await send("Swap", q.transactions.swap);
  await submitRfqTx(q.rfqId, q.claimToken, swap.transactionHash);

  // Read at the swap's block: a load-balanced RPC may otherwise answer from a node that hasn't seen it yet.
  const after = await publicClient.readContract({
    address: buy.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [account.address],
    blockNumber: swap.blockNumber,
  });
  console.log(`✅ Done. Wallet now holds ${formatUnits(after, buy.decimals)} ${buy.symbol}.`);
}

await main();
