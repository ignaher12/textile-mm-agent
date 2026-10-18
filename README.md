# Textile MM Agent

An autonomous, **LLM-supervised market maker** (a *filler*) for [Textile FX](https://app.textilecredit.com) on **Celo mainnet**, quoting the Argentine peso corridor **wARS/USD₮**.

Built for Celo's [Agents on Open Rails](https://www.loops.house/agents-on-open-rails) hackathon. Track: **Stable Agents: Open Corridors**, subtrack **Textile FX**.

> **Status: live on Celo mainnet** since 2026-10-18 as Textile maker `stitch-42220-78d8e34a`. ERC-8004 identity **agentId 9972**. Agent wallet [`0x78D8…dce3`](https://celoscan.io/address/0x78D8e34A3b47e0dBAc0930e3F58f3FC623bEdce3).

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [How Textile works (and why it shaped the design)](#how-textile-works-and-why-it-shaped-the-design)
- [Architecture](#architecture)
- [Modules](#modules)
- [The wARS corridor: what the data says](#the-wars-corridor-what-the-data-says)
- [Concepts: market making and the spread](#concepts-market-making-and-the-spread)
- [Why the LLM doesn't trade directly](#why-the-llm-doesnt-trade-directly)
- [Measuring P&L](#measuring-pl)
- [Running it](#running-it)
- [Simulator](#simulator)
- [Stack](#stack)
- [Project layout](#project-layout)
- [Hackathon requirements](#hackathon-requirements)
- [Roadmap](#roadmap)
- [Resources](#resources)

---

## What it does

The agent answers Textile's requests for quote (RFQs) on wARS/USD₮ with firm, signed prices, and earns the spread when a trader takes them. Around that execution core it adds the parts a real desk needs:

- **Its own reference price**: a median of 4 independent sources with staleness and outlier filters, not a single oracle.
- **Inventory skew**: the published price shifts with the agent's live on-chain inventory, so the side that rebalances it gets more aggressive. Textile's own bot (Stitch) has no inventory lean on RFQ.
- **A risk manager with a kill switch**: it pauses on price jumps or a divergence from Textile's price, and latches a persisted kill switch on drawdown.
- **An LLM supervisor**, the "desk head": every 10 minutes it reviews the market and sets the inventory policy, and writes down why.
- **Operations**: a graceful OFF function, a heartbeat, a status command, and a Telegram bot for alerts and remote control.

The subtrack is judged on three criteria:

| Criterion | How we address it |
|---|---|
| **Strategy P&L** | Spread capture, inventory skew, and pausing in disorderly markets (risk manager + supervisor) |
| **Volume quoted and filled** | Always-on RFQ quoting on Textile mainnet. Every fill is detected on-chain and reported |
| **Originality** | An LLM desk head with an auditable decision log, an inventory-aware price feed, and data-driven analysis of the wARS corridor |

---

## Quick start

Requires Node 24+.

```bash
npm install
npm test               # 73 unit tests
npm run price          # live reference prices for USD₮/ARS and USD₮/BRL
npm run status         # live agent: process, wallet, feed, our quotes vs the market, fills
npm run supervise      # one supervisor decision on live data, not applied
```

Running the agent itself (see [Running it](#running-it)):

```bash
npm start              # price feed + skew + risk manager + supervisor + Telegram bot
```

---

## How Textile works (and why it shaped the design)

The original plan assumed an on-chain order book with resting orders. Textile turned out to be **RFQ-based** ([docs](https://fx-docs.textilecredit.com)):

1. A trader asks for a quote for an **exact size**.
2. Online makers ("fillers") get about a second to answer with a **signed EIP-712 order** (UniswapX), exclusive to that trader and valid for ~60 s.
3. The trader gets the best quote and **broadcasts the settlement transaction**, paying gas and a 1 bps taker fee. Makers pay nothing.
4. A quote must cover the **whole size**. There are no partial fills.

What this means for a maker:

- **Quoting is gasless and off-chain.** Only the one-time Permit2 approvals cost gas.
- **Nothing rests on-chain**, so there is nothing to cancel on a crash. Quotes expire in seconds.
- **Competition is on price and capacity.** The best quote that can cover the full size wins.

The maker-side protocol isn't publicly documented. Its only implementation is **Stitch**, Textile's open-source filler bot (Rust, AGPL). So the agent uses **Stitch as its execution layer** and does everything else itself. It feeds Stitch a price that already carries the agent's inventory skew and risk state:

> Stitch quotes `print × (1 ± spread)`. We publish `print = ref × (1 − skew)`, which lands Stitch's bid and ask exactly on the quoting engine's. To stop quoting, we flag the print `degraded: true`.

---

## Architecture

```
            ┌───────────────────────────────────────────────┐
            │   LLM SUPERVISOR  ·  every 10 min              │
            │   reads market + inventory + risk →            │
            │   sets inventory policy, explains why          │
            └───────────────┬───────────────────────────────┘
                            │ validated, clamped params
 ┌──────────────┐  ref      ▼                  ┌──────────────────┐
 │ PRICE FEED   │────▶  QUOTING ENGINE  ◀──────│ on-chain         │
 │ CoinGecko    │       skew from live         │ inventory        │
 │ CriptoYa     │       inventory              │ (USD₮, wARS)     │
 │ DolarAPI     │           │                  └──────────────────┘
 │ Textile      │           ▼
 └──────────────┘      RISK MANAGER ── divergence · price jump · drawdown kill switch
                            │
                            ▼  { price: ref × (1 − skew), degraded }
                    ┌──────────────────┐   http://127.0.0.1:8787/price
                    │  FEED SERVER     │◀──────────────── Stitch polls every second
                    └──────────────────┘
                                              ┌────────────────────────────┐
     Textile RFQ (wss) ──── quote request ───▶│  STITCH (Textile's filler) │
     trader ◀──────────── signed EIP-712 ─────│  spread · balance caps     │
       │                                      └────────────────────────────┘
       └── settles on Celo (UniswapX reactor) ─▶ Fill event, swapper = our wallet

 Ops: OFF function · heartbeat (/health, data/heartbeat.json) · npm run status
      Telegram: /status /why /pause /resume /off + alerts (fills, kill switch, policy changes)
```

The agent is **one long-running process** (`npm start`) next to the Stitch desktop app. If the agent dies, Stitch's next fetch fails and it stops quoting: **every failure mode ends in "not quoting", never in "quoting a stale price"**.

---

## Modules

### Price feed ✅ `src/feeds/`

- Four independent sources, queried in parallel with a timeout:

  | Source | What it measures |
  |---|---|
  | CoinGecko | wARS / wBRL token price |
  | CriptoYa | Median mid price across ~15 exchanges' USD₮ books |
  | DolarAPI | "Dólar cripto" rate (ARS only) |
  | Textile | Textile's own price endpoint (Stitch's default feed) |

- Drops invalid and **stale** quotes, then **outliers** (> 3% off the median), then takes the **median** of the rest. At least 2 agreeing sources are required, otherwise there is no price and the agent stops quoting.
- The timestamp is that of the **oldest** input, so the reference is never fresher than its weakest source. For Stitch, sources older than 150 s are dropped: Stitch's RFQ path rejects older prints.

### Quoting engine and skew ✅ `src/engine/`, `src/stitch/`

A pure function, `(ref, params, inventory) → quotes`:

```
bid = ref × (1 − spread/2 − skew)
ask = ref × (1 + spread/2 − skew)
```

- **Skew** is proportional to the inventory imbalance against a target USD₮ share, and **capped at spread/4**, so the side pulled toward the reference always keeps a quarter of the spread as edge.
- `src/stitch/` reads the wallet's balances from the chain with every price refresh and publishes the engine's skewed midpoint. Until an inventory read succeeds, or when one fails, the print goes out `degraded`.
- Parameter bounds (`clampParams`) are hard limits nothing can override, the supervisor included. Spreads are in basis points: 2 bps to 10% full width.

### Risk manager ✅ `src/risk/`

Its only lever is the `degraded` flag. It can stop quoting, never move a price.

| Check | Trips when | Effect |
|---|---|---|
| Divergence | Our reference is > 1% away from Textile's price, or Textile's price was rejected as an outlier | Paused while it lasts |
| Price jump | The reference moves > 1.5% within 10 min (a devaluation, or a broken source) | Paused for a 15-min cooldown |
| **Kill switch** | Mark-to-market inventory value falls > 3% below its peak | **Latched and persisted**, cleared only by a human (`--reset-kill`). A corrupt state file reads as tripped |

### LLM supervisor ✅ `src/supervisor/`

Every 10 minutes the supervisor gets a JSON summary:

- reference moves over 10 min, 1 h and 6 h
- inventory, drawdown and risk state
- **our live quote vs the best maker on each side**, read from outside with restricted RFQ previews
- fills in the last 24 h
- current params and its own last three decisions

It answers with a decision:

```json
{ "paused": false, "targetBaseShare": 0.4, "maxSkewBps": 8, "inventoryBand": 0.3,
  "recommendedSpreadBps": 15,
  "reason": "The wARS offer side has only ~47 USD₮ of depth; lean toward holding wARS." }
```

- The reply is validated with `zod`. An invalid one gets a single retry that carries the validation error. The result is then clamped into the hard bounds.
- The policy reaches Stitch **live, through the feed**. Stitch's spread needs a restart, so the supervisor can only *recommend* it, and the recommendation is logged.
- If the LLM fails or times out, the last params stay. **The LLM is never on the critical path.**
- Every call (context, decision, before/after params) is appended to `data/decisions.jsonl`: an audit trail of the agent's autonomy.
- Provider-agnostic, over any OpenAI-compatible API. The default is [NVIDIA Build](https://build.nvidia.com) with `nvidia/nemotron-3-super-120b-a12b` (a reasoning model: ~1 min per decision, fine at a 10-min cadence).

### Operations ✅ `src/lifecycle/`, `src/bot/`, `scripts/status.ts`

- **OFF function**: one idempotent `shutdown()` with ordered steps, each with its own timeout:
  1. Go dark, serving `degraded` prints for 3 s so Stitch's 1 s loop sees them.
  2. Save risk state.
  3. Notify Telegram.
  4. Stop the server.
  5. Write a final heartbeat.

  It is triggered by Ctrl+C, SIGTERM, the console window closing (SIGHUP), `/off` on Telegram, and unhandled errors.
- **Heartbeat**: written to `data/heartbeat.json` on every refresh and served on `GET /health`. `npm run status` uses it to tell a clean stop from a crash.
- **Telegram bot**: `/status /why /pause /resume /off`, answered only for the owner's chat. Alerts cover start/stop, the kill switch, quoting ↔ paused changes, supervisor policy changes and every fill. A 💓 status arrives every 6 h, so silence means the agent is down.
- **`npm run status`**: one screen with the process state, the wallet, our feed vs Textile's, our live quotes vs the best market, and our fills, read from Fill events on the settlement reactor.

### On-chain ✅ `src/chain/`, `scripts/`

- Every transaction the agent sends goes through `createAgentWallet()`, which applies the **ERC-8021 attribution tag** (`@celo/attribution-tags`), so no transaction can go out untagged.
- Gas is paid in **USD₮ via Celo fee abstraction**: the wallet holds no CELO. That's also why we do the Permit2 approvals ourselves (`npm run approve`) instead of with Stitch, which needs native gas and wouldn't tag them.
- **ERC-8004 identity**: `npm run identity` registered agentId 9972, with fully on-chain `data:` URI metadata.

---

## The wARS corridor: what the data says

Read from Textile's public APIs (`/historical_trades`, `/v2/rfq/levels`, `/v2/rfq/preview`) on 2026-10-18.

**There is real flow.** Since 2026-07-15: ~1,230 fills and ~251k USD₮ of volume, split evenly between both directions. In late September to mid October that was ~1–7k USD₮ a day.

**The flow comes in ~100 USD₮ clips.** In the last 30 days the median trade was 100.0 USD₮ and the 90th percentile 100.3 USD₮, in both directions. It looks like one automated counterparty.

**The two sides are very different:**

| Trader direction | Best maker today | Depth |
|---|---|---|
| Sells wARS for USD₮ | ~0–1 bps from mid | ~97k USD₮ |
| Buys wARS with USD₮ | ~0 bps from mid | **~47 USD₮** |

The ticker shows `bid 0` for the second side only because it prices a ~100 USD₮ trade, and the one maker there can't cover it. **Any 100 USD₮ request on that side currently gets no quote.** The last fill on that side was on 2026-10-15, when that maker's inventory ran low.

So the opening in this corridor is **inventory, not price**: a maker holding ≥ ~105 USD₮ of wARS would be the only one able to fill those trades. Our current capital (~5 USD₮) is below that, so the live deployment demonstrates the full system rather than capturing the flow. The same code scales with capital: inventory is read from the chain, and capacity is whatever the wallet holds.

---

## Concepts: market making and the spread

**Example:** the "real" dollar is at 1,600 ARS. The agent quotes:

| Quote | Price | Who takes it |
|---|---|---|
| **Bid** (buy USD₮) | 1,584 | Someone who needs pesos and sells USD₮ |
| **Ask** (sell USD₮) | 1,616 | Someone who needs dollars |

If both fill, the agent bought 1 USD₮ at 1,584 and sold it at 1,616. It earned **32 ARS without betting on the price direction**. (On Textile real spreads are basis points, not 1%: this is just the idea.)

### The real risk: inventory and adverse selection

If the dollar jumps from 1,600 to 1,750, everyone buys the agent's USD₮ at 1,616, and the agent is left holding pesos that are now worth less. The mitigations, all implemented:

1. **A fresh, robust reference price**, with multiple sources, outlier rejection and short staleness limits.
2. **Inventory skew**: when the agent holds too much of one currency, it shifts its prices to offload it.
3. **Pausing on disorder**: the risk manager on price jumps and divergence, the supervisor on judgment, the kill switch on drawdown.

---

## Why the LLM doesn't trade directly

An LLM takes seconds to respond, costs money per call, and is non-deterministic. Textile gives makers about a second to answer. So the design has layers:

- **Execution (Stitch)** answers each RFQ in milliseconds.
- **Quoting engine and risk manager** (deterministic code) run every 15 s and decide the price and whether to quote at all.
- **Supervisor (LLM)** runs every ~10 minutes. It acts as the desk head: it sets the policy but never trades, and it explains every decision.

wARS moves over minutes or hours outside of one-off events, and those events are exactly what the supervisor and the risk manager watch for.

---

## Measuring P&L

```
P&L = value_now(inventory) − value_start(inventory) − gas − fees
```

Both values are in USD₮ at the reference price. Measuring *mark-to-market* matters: counting only "spread earned" would hide inventory losses. The risk manager's drawdown check uses the same measure. Makers pay no Textile fee, and quoting is gasless, so the only costs are one-time approvals.

We also report **P&L vs. hold**, which compares the result to doing nothing with the starting inventory.

---

## Running it

The live setup is a Windows PC running two things:

1. **Stitch desktop app** ([releases](https://github.com/textile-protocol/textile-stitch/releases)):
   - corridor wARS/USDT on Celo, 20 bps per side, taker leg off
   - price feed URL `http://127.0.0.1:8787/price?pair=wars-usdt`
   - `rfq_staleness_secs = 180` under `[feed]` in its `stitch.toml`
2. **The agent**, from this repo: `npm start`.

`.env` (see `.env.example`):

| Variable | Needed for |
|---|---|
| `PRIVATE_KEY` | The agent wallet (generate one with `npm run wallet:new`; it's never printed) |
| `ATTRIBUTION_TAG` | ERC-8021 tag from Loops House enrollment |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | The supervisor (off without a key) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | The Telegram bot (`npm run telegram:chat-id` finds the id) |

Other commands:

```bash
npm start -- --reset-kill          # clear a tripped kill switch after investigating
npm run approve -- --token USDT    # Permit2 approval from the agent wallet (dry run; add --send)
npm run balances                   # wallet balances + attribution tag check
npm run identity -- --repo <url>   # ERC-8004 registration (dry run; add --send)
```

State lives in `data/` (git-ignored): `risk-*.json` (kill switch), `params-*.json` (the supervisor's policy), `decisions.jsonl` (the audit log), `heartbeat.json`, `control.json` (`/pause`).

---

## Simulator

`sim/` backtests the quoting engine on hourly wARS prices from CoinGecko and on synthetic random walks with devaluation jumps:

```bash
npm run sim -- --data history --days 30 --spread 0.004
npm run sim -- --data devaluation --sweep --seed 3
```

⚠️ Its fill model (adverse crossings + probabilistic organic takers) predates what we learned about Textile, where flow arrives as RFQs for exact sizes. Use it to compare parameters against each other and to stress-test devaluations, not for absolute P&L.

---

## Stack

| Piece | Technology |
|---|---|
| Language | TypeScript (strict) + Node 24 |
| Blockchain | [`viem`](https://viem.sh) + [`@celo/attribution-tags`](https://github.com/celo-org/attribution-tags) |
| Execution | [Stitch](https://github.com/textile-protocol/textile-stitch), Textile's filler bot |
| LLM | Any OpenAI-compatible API, default [NVIDIA Build](https://build.nvidia.com) (plain `fetch`) |
| Telegram | Bot API over plain `fetch` (long polling) |
| Validation | `zod` |
| Tests | `vitest` |
| Celo reference | [Celopedia skill](https://celopedia.celo.org) in `.claude/skills/` |

---

## Project layout

```
textile-mm-agent/
├── src/
│   ├── feeds/        # price sources, aggregation, pair config
│   ├── engine/       # quoting engine and parameter bounds (pure)
│   ├── stitch/       # feed server, Stitch print format, inventory skew
│   ├── risk/         # risk manager, kill switch, persisted state
│   ├── supervisor/   # LLM supervisor: context, prompt, decision schema, audit log
│   ├── bot/          # Telegram client and commands
│   ├── lifecycle/    # OFF function, heartbeat
│   ├── textile/      # Textile RFQ previews and market snapshot
│   ├── chain/        # Celo tokens, tagged wallet, inventory, fill detection
│   └── identity/     # ERC-8004 metadata
├── scripts/          # feed-server (npm start), status, supervise, approve, balances, identity…
├── sim/              # backtester
└── test/             # vitest suites
```

---

## Hackathon requirements

- [x] Enrolled on [Loops House](https://www.loops.house/agents-on-open-rails) and got the **attribution tag**
- [x] **Attribution tag (ERC-8021)** on every transaction the agent sends (enforced by `createAgentWallet()`)
- [x] **ERC-8004 identity**: **agentId 9972** ([tx](https://celoscan.io/tx/0xead3c3e993ee2fdb11e383240032d68e1599f27034cda9d351057642edc68148))
- [x] Activity on **Celo mainnet**: registration, Permit2 approvals ([USD₮](https://celoscan.io/tx/0xb0d87848090f3149f2c597dee02fc87ae74778c1e0349da9e9ee2ea82341169d), [wARS](https://celoscan.io/tx/0x2493af79550153337f6dfeed3a41167c0abba474918d747cfc47ad0611dba9fa)), and live RFQ quoting
- [x] **Public GitHub repo**
- [x] Code written during the hackathon

| Date | Event |
|---|---|
| Mon 9 Nov, 09:00 GMT | Registration and submission deadline |
| Fri 13 Nov | Winners announced |

---

## Roadmap

- [x] Price feed, quoting engine, simulator
- [x] Wallet, attribution tag, ERC-8004 identity
- [x] Textile integration via Stitch: live RFQ quoting on mainnet
- [x] Inventory skew through the feed
- [x] Risk manager and kill switch
- [x] OFF function, heartbeat, status command
- [x] LLM supervisor with audit log
- [x] Telegram bot
- [ ] Continuous operation through the deadline, with the supervisor and Telegram live
- [ ] Two-sided inventory (wARS) so both directions are quoted
- [ ] Public evidence page: decisions, quotes and fills
- [ ] Demo video

---

## Resources

**Hackathon and Celo**
- Hackathon: https://www.loops.house/agents-on-open-rails
- Celo docs: https://docs.celo.org
- ERC-8004: https://docs.celo.org/build-on-celo/build-with-ai/8004 · [8004scan](https://8004scan.io)
- Attribution tags: https://github.com/celo-org/attribution-tags

**Textile**
- App: https://app.textilecredit.com
- Docs: https://fx-docs.textilecredit.com (filler guide: [how to become a filler](https://fx-docs.textilecredit.com/guides/how-to-become-a-filler.html))
- Stitch: https://github.com/textile-protocol/textile-stitch
- Public data: `https://api.textilecredit.com/tickers`, `/historical_trades`, `/v2/rfq/levels`

**Token addresses** (Celo mainnet)

| Token | Address | Decimals |
|---|---|---|
| wARS | `0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d` | 18 |
| wBRL | `0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0` | 18 |
| USD₮ | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | 6 |
| USD₮ fee adapter | `0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72` | |
| Textile reactor (UniswapX) | `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3` | |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | |
