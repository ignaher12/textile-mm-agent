import { z } from "zod";
import { median } from "../lib/stats.js";

const tradeSchema = z.object({ base_volume: z.string(), trade_timestamp: z.number() });
const historySchema = z.object({ buy: z.array(tradeSchema).default([]), sell: z.array(tradeSchema).default([]) });

export interface SideFlow {
  trades: number;
  volumeUsdt: number;
  /** Median trade size: RFQ quotes must cover a trade whole, so this is the capacity that matters. */
  medianUsdt: number | null;
  lastTradeHoursAgo: number | null;
}

export interface RecentFlow {
  days: number;
  traderSellsWars: SideFlow;
  traderBuysWars: SideFlow;
}

/**
 * Executed wARS trades on Textile over the last `days`, per direction, from the
 * public rates feed. In ticker terms (base USD₮) a "buy" is a trader buying
 * USD₮ with wARS, i.e. selling wARS.
 */
export async function fetchRecentFlow(days = 7, now = Date.now()): Promise<RecentFlow> {
  const res = await fetch("https://api.textilecredit.com/historical_trades?ticker_id=USDT_WARS&limit=1000", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`historical_trades HTTP ${res.status}`);
  const history = historySchema.parse(await res.json());
  const since = now / 1000 - days * 86_400;

  const side = (trades: z.infer<typeof tradeSchema>[]): SideFlow => {
    const recent = trades.filter((t) => t.trade_timestamp >= since);
    const sizes = recent.map((t) => Number(t.base_volume));
    const last = Math.max(...trades.map((t) => t.trade_timestamp), -Infinity);
    return {
      trades: recent.length,
      volumeUsdt: sizes.reduce((a, b) => a + b, 0),
      medianUsdt: sizes.length ? median(sizes) : null,
      lastTradeHoursAgo: Number.isFinite(last) ? (now / 1000 - last) / 3600 : null,
    };
  };
  return { days, traderSellsWars: side(history.buy), traderBuysWars: side(history.sell) };
}
