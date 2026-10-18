import { formatUnits, type Address, type PublicClient } from "viem";
import type { Inventory } from "../engine/quote.js";
import type { PairId } from "../feeds/pairs.js";
import { TOKENS, erc20BalanceAbi, type Token } from "./celo.js";

/** The local-currency token each pair trades against USD₮. */
export const PAIR_TOKENS: Record<PairId, Token> = {
  "USDT/ARS": TOKENS.wARS,
  "USDT/BRL": TOKENS.wBRL,
};

/** Reads the agent's on-chain inventory for a pair: USD₮ as base, the wFiat token as quote. */
export async function readInventory(
  client: Pick<PublicClient, "readContract">,
  owner: Address,
  pair: PairId,
): Promise<Inventory> {
  const read = (token: Token) =>
    client
      .readContract({ address: token.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [owner] })
      .then((raw) => Number(formatUnits(raw, token.decimals)));

  const [base, quote] = await Promise.all([read(TOKENS.USDT), read(PAIR_TOKENS[pair])]);
  return { base, quote };
}
