import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { TOKENS } from "../src/chain/celo.js";
import { readInventory } from "../src/chain/inventory.js";
import type { ReferencePrice } from "../src/feeds/aggregate.js";
import { textileSource } from "../src/feeds/sources/textile.js";
import type { FetchFn } from "../src/feeds/types.js";
import { DEFAULT_PARAMS } from "../src/engine/params.js";
import { computeQuotes } from "../src/engine/quote.js";
import { createFeedServer } from "../src/stitch/feedServer.js";
import { createSkewTracker } from "../src/stitch/skew.js";
import { toStitchPrint } from "../src/stitch/print.js";

const NOW = 1_792_274_600_000;
const ok = (price: number, timestamp = NOW - 5_000): ReferencePrice => ({
  ok: true,
  price,
  timestamp,
  used: [],
  rejected: [],
});
const none: ReferencePrice = { ok: false, reason: "only 1 usable sources (need 2)", used: [], rejected: [] };
const flat = { skew: 0, paused: false };

describe("textileSource", () => {
  it("inverts the USD₮-per-token price and converts seconds", async () => {
    const fetchFn: FetchFn = async () =>
      new Response(JSON.stringify({ pair: "wars-usdt", chainId: 42220, price: 0.000625, timestamp: 1_792_274_598 }));
    const q = await textileSource({ pair: "wars-usdt", fetchFn }).fetch(new AbortController().signal);
    expect(q).toEqual({ source: "textile:wars-usdt", price: 1600, timestamp: 1_792_274_598_000 });
  });
});

describe("toStitchPrint", () => {
  it("publishes USD₮ per token in whole Unix seconds", () => {
    expect(toStitchPrint(ok(1600, NOW - 5_500), flat, NOW)).toEqual({
      price: 1 / 1600,
      timestamp: 1_792_274_594,
      degraded: false,
    });
  });

  it("centers on the engine's skewed midpoint", () => {
    // 70% in USD₮: skewed, but both sides still quote.
    const q = computeQuotes(1600, DEFAULT_PARAMS, { base: 70, quote: 30 * 1600 });
    const [bid, ask] = q.orders;
    expect([bid?.side, ask?.side]).toEqual(["bid", "ask"]);
    const engineMid = (bid!.price + ask!.price) / 2;
    const print = toStitchPrint(ok(1600), { skew: q.skew, paused: false }, NOW)!;
    expect(q.skew).toBeGreaterThan(0);
    expect(1 / print.price).toBeCloseTo(engineMid, 9);
  });

  it("never stamps a print ahead of the clock", () => {
    expect(toStitchPrint(ok(1600, NOW + 3_000), flat, NOW)!.timestamp).toBe(NOW / 1000);
  });

  it("flags degraded when paused and yields nothing without a price", () => {
    expect(toStitchPrint(ok(1600), { skew: 0, paused: true }, NOW)!.degraded).toBe(true);
    expect(toStitchPrint(none, flat, NOW)).toBeNull();
  });
});

describe("createFeedServer", () => {
  let stop = () => {};
  afterEach(() => stop());

  async function serve(ref: ReferencePrice) {
    const srv = createFeedServer({ feeds: { "wars-usdt": { get: async () => ref } }, refreshMs: 60_000, now: () => NOW });
    stop = srv.stop;
    await srv.refresh();
    await new Promise<void>((resolve) => srv.server.listen(0, "127.0.0.1", resolve));
    const { port } = srv.server.address() as AddressInfo;
    return (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
  }

  it("serves the cached print", async () => {
    const get = await serve(ok(1600));
    const res = await get("/price?pair=wars-usdt");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ price: 1 / 1600, degraded: false });
  });

  it("fails closed without a price and rejects unknown pairs", async () => {
    const get = await serve(none);
    expect((await get("/price?pair=wars-usdt")).status).toBe(503);
    expect((await get("/price?pair=nope")).status).toBe(400);
  });
});

describe("createSkewTracker", () => {
  const params = () => DEFAULT_PARAMS;

  it("starts paused until inventory is known", () => {
    const t = createSkewTracker({ params, readInventory: async () => ({ base: 1, quote: 1600 }) });
    expect(t.get().paused).toBe(true);
  });

  it("publishes the engine's skew for the live inventory", async () => {
    const inventory = { base: 4.93, quote: 0 }; // all USD₮, like the live wallet today
    const t = createSkewTracker({ params, readInventory: async () => inventory });
    const s = await t.update(1600);
    expect(s).toMatchObject({ paused: false, inventory, baseShare: 1, imbalance: 1 });
    // Full imbalance hits the cap: a quarter of the spread.
    expect(s.skew).toBeCloseTo(DEFAULT_PARAMS.spread / 4, 12);
    expect(s.skew).toBe(computeQuotes(1600, DEFAULT_PARAMS, inventory).skew);
  });

  it("pauses when an inventory read fails", async () => {
    let fail = false;
    const t = createSkewTracker({
      params,
      readInventory: async () => {
        if (fail) throw new Error("rpc down");
        return { base: 2, quote: 3200 };
      },
    });
    await t.update(1600);
    expect(t.get().paused).toBe(false);
    fail = true;
    expect((await t.update(1600)).paused).toBe(true);
  });

  it("follows the supervisor's pause", async () => {
    const t = createSkewTracker({
      params: () => ({ ...DEFAULT_PARAMS, paused: true }),
      readInventory: async () => ({ base: 2, quote: 3200 }),
    });
    expect((await t.update(1600)).paused).toBe(true);
  });
});

describe("readInventory", () => {
  it("reads USD₮ and the pair's wFiat token with their decimals", async () => {
    const client = {
      readContract: async ({ address }: { address: string }) =>
        address === TOKENS.USDT.address ? 4_934_481n : 1_616n * 10n ** 18n,
    } as unknown as Parameters<typeof readInventory>[0];
    expect(await readInventory(client, "0x78D8e34A3b47e0dBAc0930e3F58f3FC623bEdce3", "USDT/ARS")).toEqual({
      base: 4.934481,
      quote: 1616,
    });
  });
});
