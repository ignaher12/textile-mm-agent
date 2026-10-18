import type { MakerFill } from "../chain/fills.js";
import type { Metric } from "../lifecycle/metrics.js";
import type { DecisionRecord } from "../supervisor/supervisor.js";

export interface Evidence {
  from: number;
  to: number;
  samples: number;
  /** Share of the period the agent process was up (samples arrive every `intervalMs`). */
  upShare: number;
  /** Share of the period it was actually quoting. */
  quotingShare: number;
  pauseReasons: { reason: string; samples: number }[];
  /** Capacity × time our quotes were live, in USD₮·hours, per direction. */
  quoteHoursUsdt: { bidForLocal: number; offerOfLocal: number };
  /** Average distance from reference while quoting: ours vs the best maker. */
  competitiveness: { side: string; oursBps: number | null; bestBps: number | null }[];
  pnl: {
    navStart: number;
    navEnd: number;
    holdEnd: number;
    pnlUsdt: number;
    vsHoldUsdt: number;
  } | null;
  fills: MakerFill[];
  decisions: {
    total: number;
    ok: number;
    failed: number;
    policyChanges: number;
    recent: { time: string; reason: string; recommendedSpreadBps: number | null }[];
  };
}

/**
 * Folds the metrics log, the supervisor's records and on-chain fills into the
 * numbers the report shows. `rebalancesAt` are the times (ms) of our own taker
 * swaps, which change the inventory without being maker P&L.
 */
export function summarize(
  metrics: Metric[],
  decisions: DecisionRecord[],
  fills: MakerFill[],
  intervalMs: number,
  rebalancesAt: number[] = [],
): Evidence | null {
  if (metrics.length === 0) return null;
  const sorted = [...metrics].sort((a, b) => a.t - b.t);
  const from = sorted[0]!.t;
  const to = sorted.at(-1)!.t;
  const span = Math.max(to - from + intervalMs, intervalMs);
  const hours = intervalMs / 3600_000;
  const quoting = sorted.filter((m) => m.quoting);

  const reasonCounts = new Map<string, number>();
  for (const m of sorted) {
    if (m.quoting) continue;
    for (const r of m.reasons.length ? m.reasons : ["unknown"]) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
  }

  const depth = (p: { ours: { bps: number; depthUsdt: number } | { error: string } }) => ("error" in p.ours ? 0 : p.ours.depthUsdt);
  const quoteHoursUsdt = { bidForLocal: 0, offerOfLocal: 0 };
  for (const m of quoting) {
    if (!m.market) continue;
    quoteHoursUsdt.bidForLocal += depth(m.market.traderSellsWars) * hours;
    quoteHoursUsdt.offerOfLocal += depth(m.market.traderBuysWars) * hours;
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const sideStats = (label: string, pick: (m: NonNullable<Metric["market"]>) => { ours: unknown; best: unknown }) => {
    const bps = (who: "ours" | "best") =>
      avg(
        quoting.flatMap((m) => {
          if (!m.market) return [];
          const p = pick(m.market)[who] as { bps?: number };
          return typeof p.bps === "number" ? [p.bps] : [];
        }),
      );
    return { side: label, oursBps: bps("ours"), bestBps: bps("best") };
  };

  const withNav = sorted.filter((m) => m.navUsdt !== null && m.ref !== null && m.usdt !== null && m.local !== null);
  const first = withNav[0];
  const last = withNav.at(-1);
  const pnl =
    first && last
      ? (() => {
          // The "hold" portfolio starts as our first inventory. After one of our own
          // rebalancing swaps it switches to the new mix at the value it had then, so
          // the swap's cost still counts against us but its new mix isn't read as P&L.
          let holdUsdt = first.usdt!;
          let holdLocal = first.local!;
          let prev = first;
          for (const m of withNav.slice(1)) {
            if (rebalancesAt.some((t) => t > prev.t && t <= m.t)) {
              const scale = (holdUsdt + holdLocal / m.ref!) / m.navUsdt!;
              holdUsdt = m.usdt! * scale;
              holdLocal = m.local! * scale;
            }
            prev = m;
          }
          const holdEnd = holdUsdt + holdLocal / last.ref!;
          return {
            navStart: first.navUsdt!,
            navEnd: last.navUsdt!,
            holdEnd,
            pnlUsdt: last.navUsdt! - first.navUsdt!,
            vsHoldUsdt: last.navUsdt! - holdEnd,
          };
        })()
      : null;

  const changed = (r: DecisionRecord) =>
    r.before.targetBaseShare !== r.after.targetBaseShare ||
    r.before.maxSkew !== r.after.maxSkew ||
    r.before.inventoryBand !== r.after.inventoryBand ||
    r.before.paused !== r.after.paused;

  return {
    from,
    to,
    samples: sorted.length,
    upShare: Math.min(1, (sorted.length * intervalMs) / span),
    quotingShare: Math.min(1, (quoting.length * intervalMs) / span),
    pauseReasons: [...reasonCounts].map(([reason, samples]) => ({ reason, samples })).sort((a, b) => b.samples - a.samples),
    quoteHoursUsdt,
    competitiveness: [
      sideStats("We bid for wARS (trader sells wARS)", (m) => m.traderSellsWars),
      sideStats("We offer wARS (trader buys wARS)", (m) => m.traderBuysWars),
    ],
    pnl,
    fills,
    decisions: {
      total: decisions.length,
      ok: decisions.filter((d) => d.ok).length,
      failed: decisions.filter((d) => !d.ok).length,
      policyChanges: decisions.filter((d) => d.ok && changed(d)).length,
      recent: decisions
        .filter((d) => d.decision)
        .slice(-5)
        .map((d) => ({ time: d.time, reason: d.decision!.reason, recommendedSpreadBps: d.decision!.recommendedSpreadBps ?? null })),
    },
  };
}
