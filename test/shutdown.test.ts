import { describe, expect, it } from "vitest";
import { createShutdown } from "../src/lifecycle/shutdown.js";

const quiet = () => {};

describe("createShutdown", () => {
  it("runs every step in order, once", async () => {
    const order: string[] = [];
    const { shutdown } = createShutdown({
      log: quiet,
      steps: [
        { name: "dark", run: () => void order.push("dark") },
        { name: "save", run: async () => void order.push("save") },
      ],
    });
    const [a, b] = await Promise.all([shutdown("SIGINT"), shutdown("SIGTERM")]);
    expect(order).toEqual(["dark", "save"]);
    expect(a).toBe(b);
    expect(a.reason).toBe("SIGINT");
  });

  it("keeps going past a failing or hanging step", async () => {
    const ran: string[] = [];
    const { shutdown } = createShutdown({
      log: quiet,
      steps: [
        { name: "boom", run: () => { throw new Error("rpc down"); } },
        { name: "hang", run: () => new Promise(() => {}), timeoutMs: 20 },
        { name: "save", run: () => void ran.push("save") },
      ],
    });
    const result = await shutdown("test");
    expect(ran).toEqual(["save"]);
    expect(result.failed).toEqual([
      { step: "boom", error: "rpc down" },
      { step: "hang", error: "timed out after 20 ms" },
    ]);
  });
});
