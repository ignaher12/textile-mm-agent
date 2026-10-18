import type { PairHealth } from "../lifecycle/heartbeat.js";
import type { DecisionRecord } from "../supervisor/supervisor.js";

/** What the bot can read from, and do to, the running agent. */
export interface BotDeps {
  health: () => PairHealth | undefined;
  uptimeMs: () => number;
  lastDecision: () => DecisionRecord | null;
  manualPause: () => boolean;
  setManualPause: (paused: boolean) => void;
  off: (reason: string) => void;
}

export const HELP = [
  "/status: quoting state, inventory, skew, drawdown",
  "/why: the supervisor's last decision and its reasoning",
  "/pause: stop quoting (the process keeps running)",
  "/resume: undo /pause (does not clear the kill switch)",
  "/off: OFF function: go dark, save state, stop the agent",
].join("\n");

/** Turns a chat message into a reply. Pure apart from the deps it is given, so it is unit-tested. */
export function handleCommand(text: string, deps: BotDeps): string | null {
  const command = text.split(/\s+/)[0]!.toLowerCase().replace(/@\w+$/, "");
  switch (command) {
    case "/start":
    case "/help":
      return `Textile MM Agent\n\n${HELP}`;
    case "/status":
      return formatStatus(deps.health(), deps.uptimeMs(), deps.manualPause());
    case "/why":
      return formatDecision(deps.lastDecision());
    case "/pause":
      deps.setManualPause(true);
      return "⏸ Paused by you. Stitch stops quoting within seconds. /resume to undo.";
    case "/resume":
      deps.setManualPause(false);
      return "▶️ Manual pause cleared. Quoting resumes unless the risk manager or supervisor is pausing (see /status).";
    case "/off":
      deps.off("/off from Telegram");
      return "🔴 OFF requested: going dark, saving state, stopping. Restart it from the PC (npm start).";
    default:
      return command.startsWith("/") ? `Unknown command.\n\n${HELP}` : null;
  }
}

export function formatStatus(h: PairHealth | undefined, uptimeMs: number, manualPause: boolean): string {
  if (!h) return "No data yet.";
  const state = manualPause ? "⏸ PAUSED by you" : h.quoting ? "🟢 quoting" : `🟡 PAUSED: ${h.reasons.join("; ")}`;
  const inv = h.inventory ? `${h.inventory.base.toFixed(4)} USD₮ + ${h.inventory.quote.toFixed(2)} wARS` : "unknown";
  return [
    `wARS/USD₮ ${state}`,
    h.killed ? `🔴 KILL SWITCH: ${h.killed}` : null,
    `Ref ${h.ref?.toFixed(2) ?? "?"} → published ${h.published?.toFixed(2) ?? "?"} (skew ${h.skewBps.toFixed(1)} bps)`,
    `Inventory ${inv}`,
    `Drawdown ${(h.drawdown * 100).toFixed(2)}%`,
    `Up ${(uptimeMs / 3600_000).toFixed(1)} h, last refresh ${Math.round((Date.now() - h.lastRefresh) / 1000)}s ago`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatDecision(r: DecisionRecord | null): string {
  if (!r) return "The supervisor hasn't decided anything yet (or it's off: no LLM_API_KEY).";
  if (!r.decision) return `🧠 Last call failed at ${r.time}: ${r.error}. Params unchanged.`;
  const d = r.decision;
  return [
    `🧠 ${r.time}`,
    d.reason,
    "",
    `target USD₮ share ${d.targetBaseShare}, max skew ${d.maxSkewBps} bps, band ${d.inventoryBand}${d.paused ? ", PAUSED" : ""}`,
    d.recommendedSpreadBps !== undefined ? `recommends Stitch spread ${d.recommendedSpreadBps} bps/side (not applied)` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
}
