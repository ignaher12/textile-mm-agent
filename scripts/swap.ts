// Trades on Textile as a taker from the agent wallet: RFQ for a firm quote,
// then approve + swap, both sent by us, so both carry our attribution tag and
// pay gas in USD₮. Used to rebalance inventory (e.g. buy wARS so the agent can
// quote both sides).
//
//   npm run swap -- --sell USDT --amount 2.4          # dry run: indicative preview only
//   npm run swap -- --sell USDT --amount 2.4 --send   # firm quote, approve if needed, swap
//
// --self-test trades from TEST_TAKER_KEY (a separate throwaway wallet) against
// our own maker only, to check fills end to end. Those txs carry no
// attribution tag, and the report labels the fills as self-tests, not volume.
//
//   npm run swap -- --self-test --sell USDT --amount 1 --send
import { parseArgs } from "node:util";
import { createWalletClient, formatUnits, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { TOKENS, USDT_FEE_CURRENCY, createCeloClient, erc20AllowanceAbi, erc20BalanceAbi } from "../src/chain/celo.js";
import { agentAddress, createAgentWallet } from "../src/chain/wallet.js";
import { required } from "../src/config/env.js";
import { loadEnv } from "../src/config/env.js";
import { previewRfq } from "../src/textile/rfq.js";
import { requestFirmQuote, signTakerProof, submitRfqTx } from "../src/textile/taker.js";

const CHAIN_ID = 42220;
/** Refuse quotes worse than this vs the indicative preview taken just before. */
const MAX_SLIPPAGE = 0.002;

async function main() {
  const { values: args } = parseArgs({
    options: {
      sell: { type: "string" },
      amount: { type: "string" },
      send: { type: "boolean", default: false },
      "self-test": { type: "boolean", default: false },
    },
  });
  const selfTest = args["self-test"];
  const pairs = { USDT: [TOKENS.USDT, TOKENS.wARS], wARS: [TOKENS.wARS, TOKENS.USDT] } as const;
  const pair = pairs[args.sell as keyof typeof pairs];
  if (!pair || !args.amount) {
    console.error("Usage: npm run swap -- [--self-test] --sell USDT|wARS --amount <tokens> [--send]");
    process.exitCode = 1;
    return;
  }
  const [sell, buy] = pair;
  const sellAmount = parseUnits(args.amount, sell.decimals);

  const env = loadEnv();
  let account, wallet, restrictedLiquidityWallets;
  if (selfTest) {
    account = privateKeyToAccount(required(env, "TEST_TAKER_KEY"));
    const maker = agentAddress(env);
    if (account.address === maker) throw new Error("TEST_TAKER_KEY must be a different wallet from the agent's");
    // Untagged on purpose: a self-test isn't the agent's activity.
    wallet = createWalletClient({ account, chain: celo, transport: http(env.CELO_RPC_URL) });
    restrictedLiquidityWallets = [maker];
  } else {
    ({ account, client: wallet } = createAgentWallet(env));
  }
  const publicClient = createCeloClient(env.CELO_RPC_URL);

  const balance = await publicClient.readContract({
    address: sell.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [account.address],
  });
  if (balance < sellAmount) throw new Error(`balance ${formatUnits(balance, sell.decimals)} ${sell.symbol} < ${args.amount}`);

  const preview = await previewRfq({
    chainId: CHAIN_ID, sellToken: sell.address, buyToken: buy.address, sellAmount,
    ...(restrictedLiquidityWallets && { restrictTo: restrictedLiquidityWallets }),
  });
  if ("error" in preview) throw new Error(`no indicative quote: ${preview.error}`);
  const expected = Number(formatUnits(preview.buyAmount, buy.decimals));
  console.log(`\nTaker swap from ${account.address}` + (selfTest ? `  (SELF-TEST against our maker ${restrictedLiquidityWallets![0]})` : ""));
  console.log(`  Sell     ${args.amount} ${sell.symbol}`);
  console.log(`  Expect   ~${expected.toFixed(4)} ${buy.symbol}  (rate ${preview.rate.toPrecision(6)} USD₮ per wARS, fee included)`);

  if (!args.send) {
    console.log("\nDry run only (indicative preview, nothing reserved). Re-run with --send to trade.");
    return;
  }

  const takerProof = await signTakerProof(account, CHAIN_ID);
  const q = await requestFirmQuote({
    chainId: CHAIN_ID, sellToken: sell.address, buyToken: buy.address, sellAmount, taker: account.address, takerProof,
    ...(restrictedLiquidityWallets && { restrictedLiquidityWallets }),
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

  console.log(`✅ Swap settled in block ${swap.blockNumber}.`);
  // Read at the swap's block: a load-balanced RPC may otherwise answer from a node that hasn't seen it yet.
  // That node may not know the block either, so this is informative only and never fails the run.
  const read = (blockNumber?: bigint) =>
    publicClient.readContract({
      address: buy.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [account.address],
      ...(blockNumber !== undefined && { blockNumber }),
    });
  const after = await read(swap.blockNumber).catch(() => read()).catch(() => null);
  console.log(after === null ? "  (couldn't read the new balance; check with npm run balances)" : `  Wallet now holds ${formatUnits(after, buy.decimals)} ${buy.symbol}.`);
}

await main();
