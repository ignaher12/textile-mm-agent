import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, PARAM_BOUNDS, type QuoteParams } from "../src/engine/params.js";
import { createPriceHistory, paramsView, type SupervisorContext } from "../src/supervisor/context.js";
import { applyDecision, parseDecision } from "../src/supervisor/decision.js";
import type { ChatFn } from "../src/supervisor/llm.js";
import { createSupervisor, type DecisionRecord } from "../src/supervisor/supervisor.js";

const context: SupervisorContext = {
  time: "2026-10-18T03:00:00Z",
  pair: "wARS/USD₮",
  refPrice: 1616,
  moves: { m10: 0, h1: 0.001, h6: null },
  inventory: { usdt: 4.93, local: 0, usdtShare: 1, navUsdt: 4.93 },
  skewNow: { bps: 10, imbalance: 1 },
  drawdown: 0,
  risk: { paused: false, reasons: [], killed: null },
  market: null,
  stitchSpreadBpsPerSide: 20,
  ourQuotesFromRef: { bidForLocalBps: 10, offerOfLocalBps: 30 },
  fillsLast24h: 0,
  params: paramsView(DEFAULT_PARAMS),
  recentDecisions: [],
};

const decision = {
  paused: false,
  targetBaseShare: 0.4,
  maxSkewBps: 8,
  inventoryBand: 0.3,
  recommendedSpreadBps: 15,
  reason: "Sell-wARS side has only ~47 USD₮ of depth; lean toward holding wARS.",
};

function harness(chat: ChatFn) {
  let params: QuoteParams = DEFAULT_PARAMS;
  const records: DecisionRecord[] = [];
  const sup = createSupervisor({ chat, getParams: () => params, setParams: (p) => (params = p), record: (r) => records.push(r) });
  return { sup, records, params: () => params };
}

describe("parseDecision", () => {
  it("finds the JSON inside fences and prose", () => {
    expect(parseDecision("Sure!\n```json\n" + JSON.stringify(decision) + "\n```")).toEqual(decision);
  });

  it("rejects missing fields", () => {
    expect(() => parseDecision('{"paused": false}')).toThrow();
  });
});

describe("applyDecision", () => {
  it("converts bps, clamps into bounds and never touches the spread", () => {
    const p = applyDecision(DEFAULT_PARAMS, { ...decision, targetBaseShare: 2, maxSkewBps: 9999 });
    expect(p.targetBaseShare).toBe(PARAM_BOUNDS.targetBaseShare.max);
    expect(p.maxSkew).toBe(PARAM_BOUNDS.maxSkew.max);
    expect(p.spread).toBe(DEFAULT_PARAMS.spread);
  });
});

describe("createSupervisor", () => {
  it("applies a valid decision and records it", async () => {
    const h = harness(async () => JSON.stringify(decision));
    const r = await h.sup.run(context);
    expect(r.ok).toBe(true);
    expect(h.params()).toMatchObject({ targetBaseShare: 0.4, maxSkew: 0.0008, inventoryBand: 0.3 });
    expect(h.records).toHaveLength(1);
    expect(h.records[0]!.before).toEqual(DEFAULT_PARAMS);
  });

  it("retries once with the validation error, then succeeds", async () => {
    const replies = ["I think we should lean long wARS.", JSON.stringify(decision)];
    const seen: number[] = [];
    const h = harness(async (messages) => {
      seen.push(messages.length);
      return replies.shift()!;
    });
    expect((await h.sup.run(context)).ok).toBe(true);
    expect(seen).toEqual([2, 4]); // the retry carries the bad reply and the error
  });

  it("keeps the previous params when the model keeps failing", async () => {
    const h = harness(async () => "no json here");
    const r = await h.sup.run(context);
    expect(r).toMatchObject({ ok: false, decision: null });
    expect(r.error).toMatch(/invalid decision/);
    expect(h.params()).toEqual(DEFAULT_PARAMS);
  });

  it("keeps the previous params when the API is down, without retrying", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      throw new Error("HTTP 503");
    });
    const r = await h.sup.run(context);
    expect(r.error).toMatch(/LLM call failed: HTTP 503/);
    expect(calls).toBe(1);
    expect(h.params()).toEqual(DEFAULT_PARAMS);
  });
});

describe("createPriceHistory", () => {
  it("measures moves over a window and needs enough history", () => {
    const h = createPriceHistory();
    h.add(0, 1600);
    h.add(5 * 60_000, 1608);
    expect(h.move(10 * 60_000, 5 * 60_000)).toBeNull();
    h.add(10 * 60_000, 1616);
    expect(h.move(10 * 60_000, 10 * 60_000)).toBeCloseTo(0.01, 10);
  });
});
