import type { QuoteParams } from "../engine/params.js";
import { computeQuotes, type Inventory } from "../engine/quote.js";
import type { PrintAdjustment } from "./print.js";

export interface SkewState extends PrintAdjustment {
  inventory: Inventory | null;
  baseShare: number | null;
  imbalance: number | null;
}

/**
 * Tracks the skew to publish for one pair. Inventory comes from the chain and
 * is refreshed alongside the price; the skew itself is exactly what the quoting
 * engine would apply, so Stitch's symmetric spread around our print lands on
 * the engine's bid and ask.
 *
 * Fails safe: until an inventory read succeeds, or when the last one failed,
 * the print is flagged paused rather than published without its skew.
 */
export function createSkewTracker(opts: {
  params: () => QuoteParams;
  readInventory: () => Promise<Inventory>;
}) {
  let state: SkewState = { skew: 0, paused: true, inventory: null, baseShare: null, imbalance: null };

  return {
    get: (): SkewState => state,

    /** Re-reads inventory and recomputes the skew around a fresh reference price. */
    async update(ref: number): Promise<SkewState> {
      const params = opts.params();
      try {
        const inventory = await opts.readInventory();
        const q = computeQuotes(ref, params, inventory);
        state = { skew: q.skew, paused: params.paused, inventory, baseShare: q.baseShare, imbalance: q.imbalance };
      } catch {
        state = { ...state, paused: true };
      }
      return state;
    },
  };
}
