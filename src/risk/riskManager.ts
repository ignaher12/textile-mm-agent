/**
 * Hard limits that sit between the price feed and Stitch. The only lever is
 * the print's `degraded` flag, which stops all quoting at once; nothing here
 * can move a price or a spread.
 *
 * Three checks, from soft to hard:
 * - **Divergence**: our reference vs Textile's own price. Paused only while it lasts.
 * - **Price jump**: the reference moved too far within a short window, the
 *   signature of a devaluation or a broken source. Paused for a cooldown.
 * - **Drawdown**: mark-to-market inventory value fell too far below its peak.
 *   This is the kill switch: it latches until a human resets it.
 */
export interface RiskLimits {
  /** Max |ref / textile − 1| before pausing. */
  maxDivergence: number;
  /** Max price move within `moveWindowMs` before pausing. */
  maxMove: number;
  moveWindowMs: number;
  /** How long a price-jump pause lasts. */
  cooldownMs: number;
  /** Max fall of inventory value (in USD₮ at the reference) from its peak. */
  maxDrawdown: number;
}

export const DEFAULT_LIMITS: RiskLimits = {
  maxDivergence: 0.01,
  maxMove: 0.015,
  moveWindowMs: 10 * 60_000,
  cooldownMs: 15 * 60_000,
  maxDrawdown: 0.03,
};

export interface RiskInput {
  now: number;
  /** Our reference, local currency per USD₮. */
  ref: number;
  /** Textile's own price in the same units, when it was among our sources. */
  textile?: number;
  /** Textile's price was dropped as an outlier (> the feed's max deviation). */
  textileOutlier?: boolean;
  /** Inventory value in USD₮ at `ref`. */
  nav: number;
}

/** What survives a restart: the kill switch must not reset itself. */
export interface RiskSnapshot {
  peakNav: number | null;
  killed: string | null;
}

export interface RiskDecision {
  paused: boolean;
  reasons: string[];
  killed: string | null;
  drawdown: number;
}

export function createRiskManager(limits: RiskLimits = DEFAULT_LIMITS, snapshot?: RiskSnapshot) {
  let peakNav = snapshot?.peakNav ?? null;
  let killed = snapshot?.killed ?? null;
  let cooldownUntil = 0;
  let history: { t: number; price: number }[] = [];

  return {
    evaluate(input: RiskInput): RiskDecision {
      const reasons: string[] = [];

      history = [...history.filter((h) => input.now - h.t <= limits.moveWindowMs), { t: input.now, price: input.ref }];
      const move = Math.max(...history.map((h) => Math.abs(input.ref / h.price - 1)));
      if (move > limits.maxMove) cooldownUntil = input.now + limits.cooldownMs;
      if (input.now < cooldownUntil) {
        reasons.push(`price jump: ${pct(move)} within ${limits.moveWindowMs / 60_000} min, cooling down`);
      }

      if (input.textile !== undefined) {
        const divergence = Math.abs(input.ref / input.textile - 1);
        if (divergence > limits.maxDivergence) reasons.push(`reference ${pct(divergence)} away from Textile's price`);
      }
      if (input.textileOutlier) reasons.push("Textile's price was rejected as an outlier");

      peakNav = Math.max(peakNav ?? input.nav, input.nav);
      const drawdown = peakNav > 0 ? 1 - input.nav / peakNav : 0;
      if (!killed && drawdown > limits.maxDrawdown) {
        killed = `drawdown ${pct(drawdown)} from peak ${peakNav.toFixed(4)} USD₮`;
      }
      if (killed) reasons.push(`KILL SWITCH: ${killed}`);

      return { paused: reasons.length > 0, reasons, killed, drawdown };
    },

    snapshot: (): RiskSnapshot => ({ peakNav, killed }),

    /** Clears the kill switch and restarts drawdown tracking from the current value. */
    reset() {
      killed = null;
      peakNav = null;
    },
  };
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
