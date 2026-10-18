import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, createRiskManager } from "../src/risk/riskManager.js";
import { createRiskStore } from "../src/risk/store.js";

const MIN = 60_000;
const calm = { ref: 1600, textile: 1600, nav: 5 };

describe("createRiskManager", () => {
  it("lets a calm market through", () => {
    const risk = createRiskManager();
    expect(risk.evaluate({ now: 0, ...calm })).toMatchObject({ paused: false, reasons: [], killed: null });
  });

  it("pauses while the reference diverges from Textile's price", () => {
    const risk = createRiskManager();
    expect(risk.evaluate({ now: 0, ...calm, textile: 1640 }).paused).toBe(true);
    expect(risk.evaluate({ now: MIN, ...calm }).paused).toBe(false);
  });

  it("pauses when Textile's price was dropped as an outlier", () => {
    const risk = createRiskManager();
    const { textile: _, ...noTextile } = calm;
    expect(risk.evaluate({ now: 0, ...noTextile, textileOutlier: true }).paused).toBe(true);
  });

  it("cools down after a price jump, then resumes", () => {
    const risk = createRiskManager();
    risk.evaluate({ now: 0, ...calm });
    // +2% in one minute, with Textile moving too so only the jump trips.
    const jump = risk.evaluate({ now: MIN, ref: 1632, textile: 1632, nav: 5 });
    expect(jump.paused).toBe(true);
    expect(jump.reasons[0]).toMatch(/price jump/);

    const later = { ref: 1632, textile: 1632, nav: 5 };
    expect(risk.evaluate({ now: MIN + DEFAULT_LIMITS.cooldownMs - 1, ...later }).paused).toBe(true);
    // Past the cooldown, and the 1600 print has aged out of the window.
    expect(risk.evaluate({ now: MIN + DEFAULT_LIMITS.cooldownMs + 1, ...later }).paused).toBe(false);
  });

  it("ignores slow drift that stays inside the window limit", () => {
    const risk = createRiskManager();
    let price = 1600;
    for (let t = 0; t <= 120 * MIN; t += MIN) {
      price *= 1.0005; // +0.05%/min: ~0.5% per 10 min window
      expect(risk.evaluate({ now: t, ref: price, textile: price, nav: 5 }).paused).toBe(false);
    }
  });

  it("latches the kill switch on drawdown from the peak", () => {
    const risk = createRiskManager();
    risk.evaluate({ now: 0, ...calm, nav: 5 });
    risk.evaluate({ now: MIN, ...calm, nav: 5.2 }); // new peak
    const hit = risk.evaluate({ now: 2 * MIN, ...calm, nav: 5.0 }); // −3.8%
    expect(hit.killed).toMatch(/drawdown 3\.85%/);
    // Recovering does not clear it.
    expect(risk.evaluate({ now: 3 * MIN, ...calm, nav: 5.2 }).paused).toBe(true);
  });

  it("keeps the kill switch across restarts until reset", () => {
    const first = createRiskManager();
    first.evaluate({ now: 0, ...calm, nav: 5 });
    first.evaluate({ now: MIN, ...calm, nav: 4.5 });

    const restarted = createRiskManager(DEFAULT_LIMITS, first.snapshot());
    expect(restarted.evaluate({ now: 2 * MIN, ...calm, nav: 5 }).killed).not.toBeNull();

    restarted.reset();
    expect(restarted.evaluate({ now: 3 * MIN, ...calm, nav: 4.5 }).paused).toBe(false);
  });
});

describe("createRiskStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "risk-"));

  it("round-trips a snapshot and starts clean without a file", () => {
    const store = createRiskStore(join(dir, "a", "risk.json"));
    expect(store.load()).toBeUndefined();
    store.save({ peakNav: 5, killed: "drawdown" });
    expect(store.load()).toEqual({ peakNav: 5, killed: "drawdown" });
  });

  it("fails closed on a corrupt file", () => {
    const path = join(dir, "corrupt.json");
    writeFileSync(path, "{not json");
    expect(createRiskStore(path).load()?.killed).toMatch(/unreadable/);
  });
});
