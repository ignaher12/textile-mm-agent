import type { Address, PublicClient } from "viem";
import { findMakerFills } from "../chain/fills.js";
import type { QuoteParams } from "../engine/params.js";
import type { Inventory } from "../engine/quote.js";
import type { RiskDecision } from "../risk/riskManager.js";
import { marketSnapshot } from "../textile/market.js";
import { paramsView, type SupervisorContext, type createPriceHistory } from "./context.js";

const HOUR = 3600_000;

/**
 * Gathers the supervisor's view of the live wARS corridor. Market and fill
 * reads are best effort: a failed read becomes null rather than failing the
 * run, and the model is told it is missing.
 */
export async function buildLiveContext(deps: {
  me: Address;
  client: Pick<PublicClient, "getBlockNumber" | "getLogs">;
  refPrice: number;
  history: ReturnType<typeof createPriceHistory>;
  inventory: Inventory;
  skewNow?: SupervisorContext["skewNow"];
  risk: RiskDecision;
  params: QuoteParams;
  stitchSpreadBpsPerSide: number;
  recentDecisions: SupervisorContext["recentDecisions"];
  now?: number;
}): Promise<SupervisorContext> {
  const now = deps.now ?? Date.now();
  const { base: usdt, quote: local } = deps.inventory;
  const navUsdt = usdt + local / deps.refPrice;

  const [market, fillsLast24h] = await Promise.all([
    // Textile's mid isn't needed exactly here: our ref is within ~1% of it or the risk manager pauses.
    marketSnapshot(deps.me, 1 / deps.refPrice).catch(() => null),
    deps.client
      .getBlockNumber()
      .then((head) => findMakerFills(deps.client, deps.me, head - 86_400n, head))
      .then((f) => f.length)
      .catch(() => null),
  ]);

  return {
    time: new Date(now).toISOString(),
    pair: "wARS/USD₮",
    refPrice: deps.refPrice,
    moves: {
      m10: deps.history.move(10 * 60_000, now),
      h1: deps.history.move(HOUR, now),
      h6: deps.history.move(6 * HOUR, now),
    },
    inventory: { usdt, local, usdtShare: navUsdt > 0 ? usdt / navUsdt : 1, navUsdt },
    skewNow: deps.skewNow ?? null,
    drawdown: deps.risk.drawdown,
    risk: { paused: deps.risk.paused, reasons: deps.risk.reasons, killed: deps.risk.killed },
    market,
    stitchSpreadBpsPerSide: deps.stitchSpreadBpsPerSide,
    ourQuotesFromRef: deps.skewNow
      ? {
          bidForLocalBps: deps.stitchSpreadBpsPerSide - deps.skewNow.bps,
          offerOfLocalBps: deps.stitchSpreadBpsPerSide + deps.skewNow.bps,
        }
      : null,
    fillsLast24h,
    params: paramsView(deps.params),
    recentDecisions: deps.recentDecisions,
  };
}
