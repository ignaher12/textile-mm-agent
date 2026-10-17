import { createPublicClient, http, type Address } from "viem";
import { celo } from "viem/chains";

export interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

/**
 * Celo mainnet tokens, cross-checked against the Celopedia skill and the
 * Textile FX address book. Note USD₮ has 6 decimals; the wFiat tokens have 18.
 */
export const TOKENS = {
  USDT: { symbol: "USD₮", address: "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e", decimals: 6 },
  wARS: { symbol: "wARS", address: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", decimals: 18 },
  wBRL: { symbol: "wBRL", address: "0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0", decimals: 18 },
} as const satisfies Record<string, Token>;

/**
 * Fee-abstraction adapter for paying gas in USD₮. 6-decimal tokens need the
 * adapter (not the token address) in the transaction's `feeCurrency` field.
 */
export const USDT_FEE_CURRENCY: Address = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";

export const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export function createCeloClient(rpcUrl: string) {
  return createPublicClient({ chain: celo, transport: http(rpcUrl) });
}
