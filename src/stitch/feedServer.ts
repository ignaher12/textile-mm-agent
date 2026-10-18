import { createServer, type Server, type ServerResponse } from "node:http";
import type { ReferencePrice } from "../feeds/aggregate.js";
import type { PriceFeed } from "../feeds/priceFeed.js";
import { toStitchPrint, type PrintAdjustment } from "./print.js";

export interface FeedServerOptions {
  /** One feed per Stitch pair slug (e.g. "wars-usdt"). */
  feeds: Record<string, PriceFeed>;
  /** How often each feed is refreshed in the background. */
  refreshMs: number;
  /** Current skew and pause state per slug. Defaults to no adjustment. */
  adjustment?: (slug: string) => PrintAdjustment;
  now?: () => number;
  /** Served as JSON on `GET /health`, for monitoring. */
  health?: () => unknown;
  /** Runs after each refresh, before the new price is served (e.g. to recompute skew). */
  onRefresh?: (slug: string, ref: ReferencePrice) => void | Promise<void>;
}

const NO_ADJUSTMENT: PrintAdjustment = { skew: 0, paused: false };

/**
 * HTTP price feed for Stitch: `GET /price?pair=<slug>`.
 *
 * Feeds refresh on a timer and requests are served from that cache, so a slow
 * source never delays Stitch's poll. A missing price answers 503, which makes
 * Stitch quote nothing until the next good print.
 */
export function createFeedServer(opts: FeedServerOptions): {
  server: Server;
  refresh(): Promise<void>;
  stop(): void;
} {
  const { feeds, refreshMs, adjustment = () => NO_ADJUSTMENT, now = Date.now, onRefresh, health } = opts;
  const latest = new Map<string, ReferencePrice>();

  async function refresh() {
    await Promise.all(
      Object.entries(feeds).map(async ([slug, feed]) => {
        const ref = await feed.get();
        await onRefresh?.(slug, ref);
        latest.set(slug, ref);
      }),
    );
  }

  const timer = setInterval(() => void refresh().catch(() => {}), refreshMs);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health" && health) return send(res, 200, health());
    if (req.method !== "GET" || url.pathname !== "/price") return send(res, 404, { error: "not found" });

    const slug = url.searchParams.get("pair") ?? "";
    if (!(slug in feeds)) return send(res, 400, { error: `unknown pair "${slug}"` });

    const ref = latest.get(slug);
    const print = ref && toStitchPrint(ref, adjustment(slug), now());
    if (!print) return send(res, 503, { error: ref && !ref.ok ? ref.reason : "no price yet" });
    send(res, 200, print);
  });

  return {
    server,
    refresh,
    stop() {
      clearInterval(timer);
      server.close();
    },
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
