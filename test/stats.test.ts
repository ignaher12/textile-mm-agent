import { describe, expect, it } from "vitest";
import { clamp, median } from "../src/lib/stats.js";

describe("median", () => {
  it("handles odd and even lengths without mutating input", () => {
    const input = [3, 1, 2];
    expect(median(input)).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(input).toEqual([3, 1, 2]);
  });

  it("throws on empty input", () => {
    expect(() => median([])).toThrow();
  });
});

describe("clamp", () => {
  it("bounds values", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
