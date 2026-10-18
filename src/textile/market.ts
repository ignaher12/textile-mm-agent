import { formatUnits, parseUnits, type Address } from "viem";
import { TOKENS, type Token } from "../chain/celo.js";
import { previewRfq } from "./rfq.js";

export type QuoteProbe = { bps: number; depthUsdt: number } | { error: string };

export interface SideSnapshot {
  /** Our live quote: bps from mid on the maker's side (below for bids, above for asks). */
  ours: QuoteProbe;
  /** Best quote across all makers, ours included. */
  best: QuoteProbe;
}

export interface MarketSnapshot {
  /** A trader sells wARS for USD₮: makers bid for wARS. */
  traderSellsWars: SideSnapshot;
  /** A trader sells USD₮ for wARS: makers offer wARS. */
  traderBuysWars: SideSnapshot;
}

const CHAIN_ID = 42220;

/**
 * Reads the live wARS corridor from outside, with indicative RFQ previews for
 * a small trade: once restricted to our wallet, once open to every maker.
 * `mid` is Textile's price in USD₮ per wARS.
 */
export async function marketSnapshot(me: Address, mid: number, probeUsdt = 2): Promise<MarketSnapshot> {
  const [traderSellsWars, traderBuysWars] = await Promise.all([
    probeSide(me, mid, TOKENS.wARS, TOKENS.USDT, parseUnits((probeUsdt / mid).toFixed(0), 18), -1),
    probeSide(me, mid, TOKENS.USDT, TOKENS.wARS, parseUnits(String(probeUsdt), 6), 1),
  ]);
  return { traderSellsWars, traderBuysWars };
}

async function probeSide(
  me: Address,
  mid: number,
  sell: Token,
  buy: Token,
  amount: bigint,
  sign: 1 | -1,
): Promise<SideSnapshot> {
  const req = { chainId: CHAIN_ID, sellToken: sell.address, buyToken: buy.address, sellAmount: amount };
  const [mine, market] = await Promise.all([previewRfq({ ...req, restrictTo: [me] }), previewRfq(req)]);

  const toProbe = (p: Awaited<ReturnType<typeof previewRfq>>): QuoteProbe => {
    if ("error" in p) return p;
    const available = p.availableSellAmount === null ? 0 : Number(formatUnits(p.availableSellAmount, sell.decimals));
    // Depth is quoted in the sell token; express it in USD₮.
    const depthUsdt = sell.address === TOKENS.USDT.address ? available : available * mid;
    return { bps: sign * (p.rate / mid - 1) * 1e4, depthUsdt };
  };
  return { ours: toProbe(mine), best: toProbe(market) };
}
