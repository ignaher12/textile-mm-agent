import { describe, expect, it } from "vitest";
import { handleCommand, type BotDeps } from "../src/bot/commands.js";
import type { PairHealth } from "../src/lifecycle/heartbeat.js";

const health: PairHealth = {
  quoting: true, reasons: [], ref: 1616.2, published: 1614.6, skewBps: 10,
  inventory: { base: 4.93, quote: 0 }, drawdown: 0.001, killed: null, lastRefresh: Date.now(),
};

function deps(overrides: Partial<BotDeps> = {}) {
  const calls: string[] = [];
  let paused = false;
  const d: BotDeps = {
    health: () => health,
    uptimeMs: () => 3600_000,
    lastDecision: () => null,
    manualPause: () => paused,
    setManualPause: (p) => {
      paused = p;
      calls.push(`pause:${p}`);
    },
    off: (reason) => calls.push(`off:${reason}`),
    ...overrides,
  };
  return { d, calls };
}

describe("handleCommand", () => {
  it("reports status", () => {
    const reply = handleCommand("/status", deps().d)!;
    expect(reply).toMatch(/🟢 quoting/);
    expect(reply).toMatch(/skew 10\.0 bps/);
  });

  it("shows why it is paused, and the kill switch", () => {
    const { d } = deps({ health: () => ({ ...health, quoting: false, reasons: ["price jump"], killed: "drawdown 3.2%" }) });
    const reply = handleCommand("/status", d)!;
    expect(reply).toMatch(/PAUSED: price jump/);
    expect(reply).toMatch(/KILL SWITCH: drawdown 3\.2%/);
  });

  it("pauses, resumes and turns off", () => {
    const { d, calls } = deps();
    handleCommand("/pause", d);
    expect(handleCommand("/status", d)).toMatch(/PAUSED by you/);
    handleCommand("/resume", d);
    handleCommand("/off", d);
    expect(calls).toEqual(["pause:true", "pause:false", "off:/off from Telegram"]);
  });

  it("accepts the @botname suffix Telegram adds in groups", () => {
    expect(handleCommand("/status@textile_mm_bot", deps().d)).toMatch(/quoting/);
  });

  it("explains /why before the first decision", () => {
    expect(handleCommand("/why", deps().d)).toMatch(/hasn't decided/);
  });

  it("ignores plain text and answers unknown commands with help", () => {
    expect(handleCommand("hola", deps().d)).toBeNull();
    expect(handleCommand("/foo", deps().d)).toMatch(/Unknown command/);
  });
});

describe("/why", () => {
  it("shows the effective skew cap, not the raw maxSkew", async () => {
    const { DEFAULT_PARAMS } = await import("../src/engine/params.js");
    const after = { ...DEFAULT_PARAMS, maxSkew: 0.01, targetBaseShare: 0.2 };
    const record = {
      time: "t", ok: true, error: null, before: DEFAULT_PARAMS, after, context: {} as never,
      decision: { paused: false, targetBaseShare: 0.2, maxSkewBps: 100, inventoryBand: 0.35, recommendedSpreadBps: 8, reason: "r" },
    };
    const reply = handleCommand("/why", deps({ lastDecision: () => record }).d)!;
    expect(reply).toMatch(/skew cap 10\.0 bps/);
    expect(reply).toMatch(/recommends Stitch spread 8 bps\/side/);
  });
});
