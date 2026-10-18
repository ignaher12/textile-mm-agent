import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { agentAddress } from "../src/chain/wallet.js";
import { parseEnv, required } from "../src/config/env.js";

const KEY = `0x${"ab".repeat(32)}`;

describe("parseEnv", () => {
  it("treats empty values as unset and applies defaults", () => {
    const env = parseEnv({ PRIVATE_KEY: "", CELO_RPC_URL: "", ATTRIBUTION_TAG: "" });
    expect(env.PRIVATE_KEY).toBeUndefined();
    expect(env.ATTRIBUTION_TAG).toBeUndefined();
    expect(env.CELO_RPC_URL).toBe("https://forno.celo.org");
  });

  it("accepts valid values", () => {
    const env = parseEnv({ PRIVATE_KEY: KEY, ATTRIBUTION_TAG: "celo_abc123" });
    expect(required(env, "PRIVATE_KEY")).toBe(KEY);
    expect(required(env, "ATTRIBUTION_TAG")).toBe("celo_abc123");
  });

  it("rejects malformed keys and tags without echoing them", () => {
    expect(() => parseEnv({ PRIVATE_KEY: "0x1234" })).toThrow(/PRIVATE_KEY: must be/);
    expect(() => parseEnv({ PRIVATE_KEY: "0x1234" })).not.toThrow(/0x1234/);
    expect(() => parseEnv({ ATTRIBUTION_TAG: "Bad-Tag" })).toThrow(/ATTRIBUTION_TAG/);
  });

  it("required() throws for missing values", () => {
    expect(() => required(parseEnv({}), "PRIVATE_KEY")).toThrow("PRIVATE_KEY is not set");
  });
});

describe("agentAddress", () => {
  const addressOfKey = privateKeyToAccount(KEY as `0x${string}`).address;

  it("works from AGENT_ADDRESS alone, without a key", () => {
    expect(agentAddress(parseEnv({ AGENT_ADDRESS: addressOfKey }))).toBe(addressOfKey);
  });

  it("falls back to the key's address", () => {
    expect(agentAddress(parseEnv({ PRIVATE_KEY: KEY }))).toBe(addressOfKey);
  });

  it("refuses an AGENT_ADDRESS that doesn't match the key", () => {
    const other = `0x${"cd".repeat(20)}`;
    expect(() => agentAddress(parseEnv({ PRIVATE_KEY: KEY, AGENT_ADDRESS: other }))).toThrow(/does not match/);
  });

  it("throws when neither is set", () => {
    expect(() => agentAddress(parseEnv({}))).toThrow(/AGENT_ADDRESS/);
  });
});
