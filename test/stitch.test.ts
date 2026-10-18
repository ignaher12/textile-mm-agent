import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ReferencePrice } from "../src/feeds/aggregate.js";
import { textileSource } from "../src/feeds/sources/textile.js";
import type { FetchFn } from "../src/feeds/types.js";
import { DEFAULT_PARAMS } from "../src/engine/params.js";
import { computeQuotes } from "../src/engine/quote.js";
import { createFeedServer } from "../src/stitch/feedServer.js";
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
