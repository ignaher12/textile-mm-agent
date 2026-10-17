import { describe, expect, it } from "vitest";
import { createPriceFeed } from "../src/feeds/priceFeed.js";
import { coinGeckoSource } from "../src/feeds/sources/coingecko.js";
import { criptoYaSource } from "../src/feeds/sources/criptoya.js";
import { dolarApiSource } from "../src/feeds/sources/dolarapi.js";
import type { FetchFn, PriceSource } from "../src/feeds/types.js";

const NOW = 1_792_274_600_000;
const signal = new AbortController().signal;

function fakeFetch(body: unknown, status = 200): FetchFn {
  return async () => new Response(JSON.stringify(body), { status });
}

describe("coinGeckoSource", () => {
  it("inverts the USD price", async () => {
    const source = coinGeckoSource({
      coinId: "argentine-peso",
      fetchFn: fakeFetch({ "argentine-peso": { usd: 0.000625, last_updated_at: 1_792_274_598 } }),
    });
    expect(await source.fetch(signal)).toEqual({
      source: "coingecko:argentine-peso",
      price: 1600,
      timestamp: 1_792_274_598_000,
    });
  });

  it("rejects HTTP errors", async () => {
    const source = coinGeckoSource({ coinId: "argentine-peso", fetchFn: fakeFetch({}, 429) });
    await expect(source.fetch(signal)).rejects.toThrow("HTTP 429");
  });
});

describe("criptoYaSource", () => {
  const t = NOW / 1000;
  const body = {
    a: { ask: 1610, bid: 1600, totalAsk: 1615, totalBid: 1595, time: t },
    b: { ask: 1620, bid: 1610, time: t - 60 },
    c: { ask: 1630, bid: 1620, time: t - 30 },
    stale: { ask: 1000, bid: 990, time: t - 3600 },
    crossed: { ask: 1500, bid: 1700, time: t },
    broken: { foo: "bar" },
  };

  it("takes the median mid of fresh, uncrossed exchanges", async () => {
    const source = criptoYaSource({ fiat: "ars", fetchFn: fakeFetch(body), now: () => NOW });
    const q = await source.fetch(signal);
    expect(q.price).toBe(1615);
    expect(q.timestamp).toBe(NOW - 30_000);
  });

  it("throws when too few exchanges are fresh", async () => {
    const source = criptoYaSource({
      fiat: "ars",
      fetchFn: fakeFetch(body),
      now: () => NOW,
      minExchanges: 4,
    });
    await expect(source.fetch(signal)).rejects.toThrow("only 3 fresh exchanges");
  });
});

describe("dolarApiSource", () => {
  it("uses the mid of compra and venta", async () => {
    const source = dolarApiSource({
      fetchFn: fakeFetch({ compra: 1600, venta: 1620, fechaActualizacion: "2026-10-17T20:59:00.000Z" }),
    });
    const q = await source.fetch(signal);
    expect(q.price).toBe(1610);
    expect(q.timestamp).toBe(Date.parse("2026-10-17T20:59:00.000Z"));
  });

  it("rejects malformed payloads", async () => {
    const source = dolarApiSource({ fetchFn: fakeFetch({ compra: "n/a" }) });
    await expect(source.fetch(signal)).rejects.toThrow();
  });
});

describe("createPriceFeed", () => {
  const ok = (name: string, price: number): PriceSource => ({
    name,
    fetch: async () => ({ source: name, price, timestamp: NOW }),
  });
  const failing: PriceSource = {
    name: "down",
    fetch: async () => {
      throw new Error("connection refused");
    },
  };

  it("aggregates successful sources and records failures", async () => {
    const feed = createPriceFeed({
      sources: [ok("a", 1600), ok("b", 1620), failing],
      timeoutMs: 1000,
      maxAgeMs: 60_000,
      maxDeviation: 0.03,
      minSources: 2,
      now: () => NOW,
    });
    const ref = await feed.get();
    expect(ref.ok && ref.price).toBe(1610);
    expect(ref.rejected).toEqual([{ source: "down", reason: "connection refused" }]);
  });
});
