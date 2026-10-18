// Builds reports/EVIDENCE.md from the agent's own records and the chain:
// uptime, quoted capacity, competitiveness, P&L vs hold, fills, supervisor
// decisions, and every transaction the agent sent (all attribution-tagged).
//
//   npm run report
//   npm run report -- --data tmp --out tmp/EVIDENCE.md
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { createCeloClient } from "../src/chain/celo.js";
import { findMakerFills } from "../src/chain/fills.js";
import { loadEnv, required } from "../src/config/env.js";
import { createMetricsLog } from "../src/lifecycle/metrics.js";
import { summarize, type Evidence } from "../src/report/evidence.js";
import type { DecisionRecord } from "../src/supervisor/supervisor.js";

const METRICS_INTERVAL_MS = 5 * 60_000;
const { values: args } = parseArgs({
  options: { data: { type: "string", default: "data" }, out: { type: "string", default: "reports/EVIDENCE.md" } },
});
const OUT = args.out;

/** Transactions the agent wallet sent itself. Swaps are sent by takers, so they show up as fills instead. */
const AGENT_TXS = [
  { what: "ERC-8004 identity registration (agentId 9972)", hash: "0xead3c3e993ee2fdb11e383240032d68e1599f27034cda9d351057642edc68148" },
  { what: "Permit2 approval, USD₮", hash: "0xb0d87848090f3149f2c597dee02fc87ae74778c1e0349da9e9ee2ea82341169d" },
  { what: "Permit2 approval, wARS", hash: "0x2493af79550153337f6dfeed3a41167c0abba474918d747cfc47ad0611dba9fa" },
];

const env = loadEnv();
const me = privateKeyToAccount(required(env, "PRIVATE_KEY")).address;
const client = createCeloClient(env.CELO_RPC_URL);

const metrics = createMetricsLog(`${args.data}/metrics.jsonl`).read();
const decisionsFile = `${args.data}/decisions.jsonl`;
const decisions: DecisionRecord[] = existsSync(decisionsFile)
  ? readFileSync(decisionsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];

const head = await client.getBlockNumber();
const since = metrics.length ? Math.min(...metrics.map((m) => m.t)) : Date.now() - 86_400_000;
// Celo makes a block about every second.
const fromBlock = head - BigInt(Math.ceil((Date.now() - since) / 1000)) - 600n;
const fills = await findMakerFills(client, me, fromBlock, head);

const e = summarize(metrics, decisions, fills, METRICS_INTERVAL_MS);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, render(e));
console.log(`Wrote ${OUT} (${metrics.length} metric samples, ${decisions.length} decisions, ${fills.length} fills)`);

function render(e: Evidence | null): string {
  const iso = (t: number) => new Date(t).toISOString().replace(".000Z", "Z").replace("T", " ");
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const usd = (x: number) => `${x.toFixed(4)} USD₮`;
  const bps = (x: number | null) => (x === null ? "—" : `${x.toFixed(1)} bps`);
  const lines = [
    "# Evidence: Textile MM Agent on Celo mainnet",
    "",
    `Generated ${iso(Date.now())} by \`npm run report\` from the agent's own logs and on-chain data.`,
    "",
    "## Identity",
    "",
    `- Agent wallet: [\`${me}\`](https://celoscan.io/address/${me})`,
    `- ERC-8004 agentId **9972** ([8004scan](https://8004scan.io))`,
    `- Textile maker: \`stitch-42220-78d8e34a\` on the wars-usdt-celo corridor`,
    "",
    "## Transactions sent by the agent",
    "",
    "Every one carries the ERC-8021 attribution tag (enforced by `createAgentWallet()`), and gas was paid in USD₮.",
    "",
    "| What | Tx |",
    "|---|---|",
    ...AGENT_TXS.map((t) => `| ${t.what} | [${t.hash.slice(0, 10)}…](https://celoscan.io/tx/${t.hash}) |`),
    "",
  ];
  if (!e) return [...lines, "_No metrics recorded yet: run the agent (`npm start`) and come back after a few samples._", ""].join("\n");

  lines.push(
    "## Operation",
    "",
    `- Period: ${iso(e.from)} → ${iso(e.to)} (${((e.to - e.from) / 3600_000).toFixed(1)} h, ${e.samples} samples every 5 min)`,
    `- Agent process up: **${pct(e.upShare)}** of the period`,
    `- Quoting: **${pct(e.quotingShare)}** of the period`,
    `- Quoted capacity × time: **${e.quoteHoursUsdt.bidForLocal.toFixed(2)} USD₮·h** bidding for wARS, ` +
      `**${e.quoteHoursUsdt.offerOfLocal.toFixed(2)} USD₮·h** offering wARS`,
    "",
  );
  if (e.pauseReasons.length) {
    lines.push("Why it wasn't quoting (samples):", "", ...e.pauseReasons.map((r) => `- ${r.reason}: ${r.samples}`), "");
  }

  lines.push(
    "## Competitiveness",
    "",
    "Average distance from our reference while quoting, read from outside with restricted RFQ previews (~2 USD₮ probe).",
    "",
    "| Side | Ours | Best maker |",
    "|---|---|---|",
    ...e.competitiveness.map((c) => `| ${c.side} | ${bps(c.oursBps)} | ${bps(c.bestBps)} |`),
    "",
    "## P&L (mark-to-market, in USD₮ at our reference)",
    "",
  );
  if (e.pnl) {
    lines.push(
      `| | |`,
      `|---|---|`,
      `| Inventory value at start | ${usd(e.pnl.navStart)} |`,
      `| Inventory value now | ${usd(e.pnl.navEnd)} |`,
      `| **P&L** | **${usd(e.pnl.pnlUsdt)}** |`,
      `| Holding the starting inventory instead | ${usd(e.pnl.holdEnd)} |`,
      `| **P&L vs hold** | **${usd(e.pnl.vsHoldUsdt)}** |`,
      "",
      "Balances are read from the chain, so gas and fees are already in these numbers.",
      "",
    );
  } else {
    lines.push("_Not enough data yet._", "");
  }

  lines.push(`## Fills (${e.fills.length})`, "");
  lines.push(
    ...(e.fills.length
      ? e.fills.map((f) => `- block ${f.blockNumber}, taker \`${f.taker}\`: [tx](https://celoscan.io/tx/${f.txHash})`)
      : ["None yet. Typical wARS trades are ~100 USD₮, above this deployment's capacity (see the README)."]),
    "",
    "## Supervisor (LLM)",
    "",
    `- Calls: ${e.decisions.total} (${e.decisions.ok} valid, ${e.decisions.failed} failed and ignored)`,
    `- Policy changes applied: ${e.decisions.policyChanges}`,
    "- Full log with the context of each call: `data/decisions.jsonl`",
    "",
    "Latest decisions:",
    "",
    ...e.decisions.recent.map(
      (d) => `- **${iso(Date.parse(d.time))}**: ${d.reason}` + (d.recommendedSpreadBps !== null ? ` _(spread rec.: ${d.recommendedSpreadBps} bps/side)_` : ""),
    ),
    "",
  );
  return lines.join("\n");
}
