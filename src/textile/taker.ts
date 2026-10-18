import { randomBytes } from "node:crypto";
import { toHex, type Address, type Hex, type LocalAccount } from "viem";
import { z } from "zod";

const API = "https://api.textilecredit.com/v2";

export interface TakerProof {
  nonce: Hex;
  issuedAt: number;
  signature: Hex;
}

/**
 * Proof that we control the taker wallet: an EIP-712 TakerControl signature
 * over (taker, chainId, nonce, issuedAt). It approves nothing; Textile needs
 * it before soliciting firm quotes for a wallet. Valid for ~60 s.
 */
export async function signTakerProof(account: LocalAccount, chainId: number, now = Date.now()): Promise<TakerProof> {
  const nonce = toHex(randomBytes(32));
  const signature = await account.signTypedData({
    domain: { name: "Textile Taker Control", version: "1", chainId },
    types: {
      TakerControl: [
        { name: "taker", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "issuedAt", type: "uint256" },
      ],
    },
    primaryType: "TakerControl",
    message: { taker: account.address, chainId: BigInt(chainId), nonce, issuedAt: BigInt(now) },
  });
  return { nonce, issuedAt: now, signature };
}

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/).transform((v) => v as Hex);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v as Address);
const unsignedTx = z.object({ to: address, data: hex, value: z.string(), chainId: z.number() });

const quotedSchema = z.object({
  data: z.object({
    rfqId: z.string(),
    claimToken: z.string(),
    status: z.literal("quoted"),
    quote: z.object({
      sellAmount: z.string(),
      buyAmount: z.string(),
      takerPays: z.string(),
      rateRay: z.string(),
      expiresAt: z.string(),
      spender: address.optional(),
      reactor: address,
    }),
    transactions: z.object({ approval: unsignedTx, swap: unsignedTx }),
  }),
});
const noQuoteSchema = z.object({ data: z.object({ status: z.literal("no_quote"), reason: z.string() }) });

export type FirmQuote = z.infer<typeof quotedSchema>["data"];

/**
 * Asks Textile for a firm, taker-bound quote with ready-to-broadcast calldata.
 * It blocks while makers answer (up to ~70 s on a cold corridor), and a firm
 * quote reserves the maker's inventory until it expires, so only call this
 * when about to trade.
 */
export async function requestFirmQuote(req: {
  chainId: number;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  taker: Address;
  takerProof: TakerProof;
  /** Only these makers may quote (up to 10 operator addresses). */
  restrictedLiquidityWallets?: Address[];
}): Promise<FirmQuote | { noQuote: string }> {
  const res = await fetch(`${API}/rfq/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...req, sellAmount: req.sellAmount.toString() }),
    signal: AbortSignal.timeout(75_000),
  });
  const body: unknown = await res.json();
  const none = noQuoteSchema.safeParse(body);
  if (none.success) return { noQuote: none.data.data.reason };
  const quoted = quotedSchema.safeParse(body);
  if (!res.ok || !quoted.success) throw new Error(`rfq/request HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return quoted.data.data;
}

/** Tells Textile which tx settled the quote. Optional (settlement is reconciled on-chain), so failures are ignored. */
export async function submitRfqTx(rfqId: string, claimToken: string, txHash: Hex): Promise<void> {
  await fetch(`${API}/rfq/${rfqId}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-rfq-claim": claimToken },
    body: JSON.stringify({ txHash }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}
