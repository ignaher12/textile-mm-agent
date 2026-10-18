import { withAttribution } from "@celo/attribution-tags";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { required, type Env } from "../config/env.js";

/**
 * The agent wallet's address, from AGENT_ADDRESS or else derived from
 * PRIVATE_KEY. Processes that only read the chain use this, so the key can
 * stay off machines that don't sign transactions.
 */
export function agentAddress(env: Env): `0x${string}` {
  const fromKey = env.PRIVATE_KEY && privateKeyToAccount(env.PRIVATE_KEY).address;
  if (env.AGENT_ADDRESS && fromKey && env.AGENT_ADDRESS.toLowerCase() !== fromKey.toLowerCase()) {
    throw new Error("AGENT_ADDRESS does not match PRIVATE_KEY");
  }
  const address = env.AGENT_ADDRESS ?? fromKey;
  if (!address) throw new Error("set AGENT_ADDRESS (or PRIVATE_KEY) in .env");
  return address;
}

/**
 * Our own throwaway wallets that traded against our maker to test fills end to
 * end (`npm run swap -- --self-test`). Keep past ones here; the current
 * TEST_TAKER_KEY's address is added automatically.
 */
const SELF_TEST_TAKERS = ["0x5E9829C7620aa05B3d25CD9294740C04077aC3fF"];

/** Lowercased addresses whose fills are our own self-tests: listed, but never counted as volume or flow. */
export function selfTestTakers(env: Env): Set<string> {
  const current = env.TEST_TAKER_KEY ? [privateKeyToAccount(env.TEST_TAKER_KEY).address] : [];
  return new Set([...SELF_TEST_TAKERS, ...current].map((a) => a.toLowerCase()));
}

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
