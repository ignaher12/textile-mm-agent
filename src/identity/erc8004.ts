import type { Address } from "viem";

/** ERC-8004 Identity Registry on Celo mainnet (agents are ERC-721 tokens). */
export const IDENTITY_REGISTRY: Address = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

export const identityRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

export interface AgentMetadata {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  name: string;
  description: string;
  services: { name: string; endpoint: string; version?: string }[];
  supportedTrust: string[];
}

export function buildAgentMetadata(repoUrl: string): AgentMetadata {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Textile MM Agent",
    description:
      "Autonomous, LLM-supervised market maker (filler) for Latin American stablecoin " +
      "corridors (wARS/USDT, wBRL/USDT) on Textile FX, Celo mainnet. " +
      "Built for the Agents on Open Rails hackathon.",
    services: [{ name: "web", endpoint: repoUrl }],
    supportedTrust: ["reputation"],
  };
}

/**
 * Encodes metadata as a base64 `data:` URI. It lives fully on-chain and is
 * content-addressed, so no IPFS pinning is needed and it can't be swapped later.
 */
export function toDataUri(metadata: AgentMetadata): string {
  const json = JSON.stringify(metadata);
  return `data:application/json;base64,${Buffer.from(json, "utf8").toString("base64")}`;
}
