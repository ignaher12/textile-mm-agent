import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/engine/params.js";
import type { PricePoint } from "../sim/prices.js";
import { runSimulation, type SimConfig } from "../sim/simulator.js";

const flat = (price: number, steps: number): PricePoint[] =>
  Array.from({ length: steps }, (_, i) => ({ t: i, price }));

const config = (overrides: Partial<SimConfig> = {}): SimConfig => ({
  prices: flat(1600, 200),
  params: DEFAULT_PARAMS,
  initialInventory: { base: 50, quote: 50 * 1600 },
  fillModel: { takerRate: 0.3, decay: 0.5 },
  gasPerRequote: 0,
  requoteThreshold: 0.002,
  feeRate: 0,
  seed: 42,
  ...overrides,
});

describe("runSimulation", () => {
  it("is deterministic for a given seed", () => {
    expect(runSimulation(config()).pnl).toBe(runSimulation(config()).pnl);
    expect(runSimulation(config()).pnl).not.toBe(runSimulation(config({ seed: 7 })).pnl);
  });

  it("earns the spread on a flat market with organic flow", () => {
    const result = runSimulation(config());
    expect(result.fills.length).toBeGreaterThan(0);
    expect(result.fills.every((f) => f.kind === "organic")).toBe(true);
    expect(result.pnl).toBeGreaterThan(0);
  });

  it("does nothing without takers on a flat market", () => {
    const result = runSimulation(config({ fillModel: { takerRate: 0, decay: 0 } }));
    expect(result.fills).toEqual([]);
    expect(result.pnl).toBe(0);
  });

  it("charges gas and fees against P&L", () => {
    const base = runSimulation(config());
    const costly = runSimulation(config({ gasPerRequote: 0.01, feeRate: 0.001 }));
    expect(costly.gasSpent).toBeCloseTo(base.requotes * 0.01);
    expect(costly.pnl).toBeLessThan(base.pnl);
  });

  it("gets run over on a sudden devaluation", () => {
    // Price jumps 10% at once: the resting ask is taken by an arbitrageur.
    const prices = [...flat(1600, 2), ...flat(1760, 2)];
    const result = runSimulation(config({ prices, fillModel: { takerRate: 0, decay: 0 } }));
    expect(result.fills).toMatchObject([{ side: "ask", kind: "crossing" }]);
    expect(result.alpha).toBeLessThan(0);
  });
});
