import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/engine/params.js";
import type { Metric } from "../src/lifecycle/metrics.js";
import { summarize } from "../src/report/evidence.js";
import type { DecisionRecord } from "../src/supervisor/supervisor.js";

const MIN5 = 5 * 60_000;
const market = (oursDepth: number) => ({
  traderSellsWars: { ours: { bps: 10, depthUsdt: oursDepth }, best: { bps: 1, depthUsdt: 97_000 } },
  traderBuysWars: { ours: { error: "no_restricted_liquidity" }, best: { bps: 0, depthUsdt: 47 } },
});
const sample = (i: number, over: Partial<Metric> = {}): Metric => ({
  t: i * MIN5, quoting: true, reasons: [], ref: 1600, skewBps: 10,
  usdt: 5, local: 0, navUsdt: 5, market: market(5), ...over,
});

describe("summarize", () => {
  it("returns null without metrics", () => {
    expect(summarize([], [], [], MIN5)).toBeNull();
  });

  it("measures uptime, quoting time and pause reasons", () => {
    const metrics = [sample(0), sample(1), sample(2, { quoting: false, reasons: ["price jump"] }), sample(3)];
    const e = summarize(metrics, [], [], MIN5)!;
    expect(e.upShare).toBe(1);
    expect(e.quotingShare).toBe(0.75);
    expect(e.pauseReasons).toEqual([{ reason: "price jump", samples: 1 }]);
  });

  it("counts a gap in samples as downtime", () => {
    const e = summarize([sample(0), sample(3)], [], [], MIN5)!; // 10 min missing
    expect(e.upShare).toBe(0.5);
  });

  it("integrates quoted capacity over time", () => {
    const e = summarize([sample(0), sample(1), sample(2)], [], [], MIN5)!;
    expect(e.quoteHoursUsdt.bidForLocal).toBeCloseTo(3 * 5 * (5 / 60), 10);
    expect(e.quoteHoursUsdt.offerOfLocal).toBe(0);
    expect(e.competitiveness[0]).toMatchObject({ oursBps: 10, bestBps: 1 });
    expect(e.competitiveness[1]).toMatchObject({ oursBps: null, bestBps: 0 });
  });

  it("marks P&L to market and against holding the starting inventory", () => {
    // Start: 5 USD₮ + 1600 wARS at 1600 (NAV 6). End: we sold the wARS at a profit, then ARS fell to 1700.
    const metrics = [
      sample(0, { usdt: 5, local: 1600, navUsdt: 6 }),
      sample(1, { ref: 1700, usdt: 6.05, local: 0, navUsdt: 6.05 }),
    ];
    const e = summarize(metrics, [], [], MIN5)!;
    expect(e.pnl!.pnlUsdt).toBeCloseTo(0.05, 10);
    // Holding would be worth 5 + 1600/1700 = 5.941…
    expect(e.pnl!.holdEnd).toBeCloseTo(5 + 1600 / 1700, 10);
    expect(e.pnl!.vsHoldUsdt).toBeCloseTo(6.05 - (5 + 1600 / 1700), 10);
  });

  it("counts supervisor calls and real policy changes", () => {
    const base = { time: "t", error: null, before: DEFAULT_PARAMS, context: {} as never };
    const decision = { paused: false, targetBaseShare: 0.2, maxSkewBps: 100, inventoryBand: 0.2, reason: "lean wARS", recommendedSpreadBps: 20 };
    const records: DecisionRecord[] = [
      { ...base, ok: true, decision, after: { ...DEFAULT_PARAMS, targetBaseShare: 0.2 } },
      { ...base, ok: true, decision, after: DEFAULT_PARAMS },
      { ...base, ok: false, decision: null, error: "timeout", after: DEFAULT_PARAMS },
    ];
    const e = summarize([sample(0)], records, [], MIN5)!;
    expect(e.decisions).toMatchObject({ total: 3, ok: 2, failed: 1, policyChanges: 1 });
    expect(e.decisions.recent).toHaveLength(2);
  });
});
