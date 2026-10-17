import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, PARAM_BOUNDS, clampParams, type QuoteParams } from "../src/engine/params.js";
import { computeQuotes, type Inventory } from "../src/engine/quote.js";

const REF = 1600;
const params: QuoteParams = { ...DEFAULT_PARAMS, spread: 0.02, orderSize: 10, maxSkew: 0.01 };
/** Inventory worth `total` USD₮ with the given share held in USD₮. */
const inventory = (baseShare: number, total = 100): Inventory => ({
  base: total * baseShare,
  quote: total * (1 - baseShare) * REF,
});

const sides = (orders: { side: string }[]) => orders.map((o) => o.side);

describe("computeQuotes", () => {
  it("quotes symmetrically around the reference when balanced", () => {
    const { orders, skew } = computeQuotes(REF, params, inventory(0.5));
    expect(skew).toBe(0);
    expect(orders).toEqual([
      { side: "bid", price: 1584, size: 10 },
      { side: "ask", price: 1616, size: 10 },
    ]);
  });

  it("shifts both prices down when holding too much USD₮", () => {
    const { orders, skew } = computeQuotes(REF, params, inventory(0.7));
    expect(skew).toBeGreaterThan(0);
    const [bid, ask] = orders;
    expect(bid!.price).toBeLessThan(1584);
    expect(ask!.price).toBeLessThan(1616);
  });

  it("shifts both prices up when holding too little USD₮", () => {
    const { orders, skew } = computeQuotes(REF, params, inventory(0.3));
    expect(skew).toBeLessThan(0);
    const [bid, ask] = orders;
    expect(bid!.price).toBeGreaterThan(1584);
    expect(ask!.price).toBeGreaterThan(1616);
  });

  it("stops bidding at full USD₮ imbalance and stops asking at the opposite end", () => {
    expect(sides(computeQuotes(REF, params, inventory(0.9)).orders)).toEqual(["ask"]);
    expect(sides(computeQuotes(REF, params, inventory(0.1)).orders)).toEqual(["bid"]);
  });

  it("always keeps at least a quarter of the spread as edge on both sides", () => {
    const wideSkew = { ...params, spread: 0.01, maxSkew: 0.05 };
    const minEdge = REF * (wideSkew.spread / 4);
    for (let share = 0; share <= 1; share += 0.05) {
      for (const order of computeQuotes(REF, wideSkew, inventory(share)).orders) {
        const edge = order.side === "bid" ? REF - order.price : order.price - REF;
        expect(edge).toBeGreaterThanOrEqual(minEdge - 1e-9);
      }
    }
  });

  it("limits sizes to available balances and drops dust orders", () => {
    // 3 USD₮ + 0.5 USD₮ worth of ARS: the bid would be dust, the ask is capped at 3.
    const { orders } = computeQuotes(REF, params, { base: 3, quote: 0.5 * REF });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ side: "ask", size: 3 });
  });

  it("quotes nothing when paused or empty", () => {
    expect(computeQuotes(REF, { ...params, paused: true }, inventory(0.5)).orders).toEqual([]);
    expect(computeQuotes(REF, params, { base: 0, quote: 0 }).orders).toEqual([]);
  });
});

describe("clampParams", () => {
  it("forces parameters into bounds", () => {
    const clamped = clampParams({ ...params, spread: 0.0001, orderSize: 1e6, maxSkew: -1 });
    expect(clamped.spread).toBe(PARAM_BOUNDS.spread.min);
    expect(clamped.orderSize).toBe(PARAM_BOUNDS.orderSize.max);
    expect(clamped.maxSkew).toBe(PARAM_BOUNDS.maxSkew.min);
    expect(clamped.paused).toBe(params.paused);
  });
});
