import { z } from "zod";

const API = "https://api.textilecredit.com";

const previewSchema = z.object({
  data: z.object({
    sellAmount: z.string(),
    buyAmount: z.string(),
    /** Price in debt per collateral (e.g. USD₮ per wARS), scaled by 1e27. */
    rateRay: z.string(),
    availableSellAmount: z.string().optional(),
  }),
});

const noQuoteSchema = z.object({
  data: z.object({ status: z.literal("no_quote"), reason: z.string() }),
});

export interface Preview {
  sellAmount: bigint;
  buyAmount: bigint;
  /** USD₮ per token, whatever the trade direction. */
  rate: number;
  availableSellAmount: bigint | null;
}

/**
 * Indicative RFQ price for a trade, without soliciting a firm quote. Passing
 * `restrictTo` prices only those makers' published levels, which is how we see
 * our own live quote from the outside.
 */
export async function previewRfq(req: {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  restrictTo?: string[];
}): Promise<Preview | { error: string }> {
  const res = await fetch(`${API}/v2/rfq/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chainId: req.chainId,
      sellToken: req.sellToken,
      buyToken: req.buyToken,
      sellAmount: req.sellAmount.toString(),
      ...(req.restrictTo && { restrictedLiquidityWallets: req.restrictTo }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body: unknown = await res.json();
  // "No quote" is a 200 with a status and reason, e.g. no_restricted_liquidity.
  const noQuote = noQuoteSchema.safeParse(body);
  if (noQuote.success) return { error: noQuote.data.data.reason };
  const parsed = previewSchema.safeParse(body);
  if (!res.ok || !parsed.success) return { error: errorText(body, res.status) };

  const d = parsed.data.data;
  return {
    sellAmount: BigInt(d.sellAmount),
    buyAmount: BigInt(d.buyAmount),
    rate: Number(BigInt(d.rateRay)) / 1e27,
    availableSellAmount: d.availableSellAmount ? BigInt(d.availableSellAmount) : null,
  };
}

function errorText(body: unknown, status: number): string {
  const e = (body as { error?: unknown })?.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "code" in e) return String((e as { code: unknown }).code);
  return `HTTP ${status}`;
}
