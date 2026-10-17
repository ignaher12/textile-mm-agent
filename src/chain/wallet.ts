import { withAttribution } from "@celo/attribution-tags";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { required, type Env } from "../config/env.js";

/**
 * The agent's wallet client. This is the only way the agent sends
 * transactions, and it appends the ERC-8021 attribution tag to every one of
 * them, so no transaction can go out untagged.
 */
export function createAgentWallet(env: Env) {
  const account = privateKeyToAccount(required(env, "PRIVATE_KEY"));
  const tag = required(env, "ATTRIBUTION_TAG");
  const client = createWalletClient({ account, chain: celo, transport: http(env.CELO_RPC_URL) });
  return { account, client: client.extend(withAttribution(tag)) };
}
