import { describe, expect, it } from "vitest";
import { buildAgentMetadata, toDataUri } from "../src/identity/erc8004.js";

describe("ERC-8004 metadata", () => {
  const metadata = buildAgentMetadata("https://github.com/someone/textile-mm-agent");

  it("follows the registration-v1 shape (services with name + endpoint)", () => {
    expect(metadata.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(metadata.services).toEqual([
      { name: "web", endpoint: "https://github.com/someone/textile-mm-agent" },
    ]);
    expect(metadata).not.toHaveProperty("endpoints");
  });

  it("round-trips through a base64 data URI", () => {
    const uri = toDataUri(metadata);
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    const decoded = JSON.parse(Buffer.from(uri.split(",")[1]!, "base64").toString("utf8"));
    expect(decoded).toEqual(metadata);
  });
});
