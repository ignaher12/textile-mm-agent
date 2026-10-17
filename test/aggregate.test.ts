import { describe, expect, it } from "vitest";
import { aggregate, type AggregateOptions } from "../src/feeds/aggregate.js";
import type { PriceQuote } from "../src/feeds/types.js";

const NOW = 1_800_000_000_000;
const opts: AggregateOptions = { now: NOW, maxAgeMs: 60_000, maxDeviation: 0.03, minSources: 2 };
const quote = (source: string, price: number, ageMs = 0): PriceQuote => ({
  source,
  price,
  timestamp: NOW - ageMs,
});

describe("aggregate", () => {
  it("returns the median of agreeing sources", () => {
    const ref = aggregate([quote("a", 1600), quote("b", 1610), quote("c", 1620)], [], opts);
    expect(ref.ok && ref.price).toBe(1610);
    expect(ref.rejected).toEqual([]);
  });

  it("drops stale quotes", () => {
    const ref = aggregate([quote("a", 1600), quote("b", 1610), quote("old", 1500, 120_000)], [], opts);
    expect(ref.ok && ref.price).toBe(1605);
    expect(ref.rejected).toEqual([{ source: "old", reason: expect.stringContaining("stale") }]);
  });

  it("drops outliers against the median", () => {
    const ref = aggregate([quote("a", 1600), quote("b", 1605), quote("bad", 2000)], [], opts);
    expect(ref.ok && ref.price).toBe(1602.5);
    expect(ref.rejected[0]).toMatchObject({ source: "bad", reason: expect.stringContaining("outlier") });
  });

  it("drops invalid prices", () => {
    const ref = aggregate([quote("a", 1600), quote("b", 1600), quote("nan", Number.NaN)], [], opts);
    expect(ref.ok).toBe(true);
    expect(ref.rejected.map((r) => r.source)).toEqual(["nan"]);
  });

  it("fails without enough sources and keeps prior rejections", () => {
    const ref = aggregate([quote("a", 1600)], [{ source: "down", reason: "timeout" }], opts);
    expect(ref.ok).toBe(false);
    expect(ref.rejected).toEqual([{ source: "down", reason: "timeout" }]);
  });

  it("fails when outlier removal leaves too few sources", () => {
    const ref = aggregate([quote("a", 1600), quote("b", 2000)], [], opts);
    expect(ref.ok).toBe(false);
  });

  it("reports the oldest input timestamp", () => {
    const ref = aggregate([quote("a", 1600, 5_000), quote("b", 1600, 30_000)], [], opts);
    expect(ref.ok && ref.timestamp).toBe(NOW - 30_000);
  });
});
