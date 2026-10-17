# Textile MM Agent

An autonomous **market-making agent** for [Textile FX](https://app.textilecredit.com) on **Celo mainnet**, quoting Latin American stablecoin pairs (wARS/USD₮, wBRL/USD₮).

Built for Celo's [Agents on Open Rails](https://www.loops.house/agents-on-open-rails) hackathon. Track: **Stable Agents: Open Corridors**, subtrack **Textile FX**.

> Status: 🚧 week 1. The price feed, quoting engine and simulator are working. On-chain execution is next.

---

## Contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
- [Concepts: market making and the spread](#concepts-market-making-and-the-spread)
- [Why the LLM doesn't trade directly](#why-the-llm-doesnt-trade-directly)
- [Architecture](#architecture)
- [Modules](#modules)
- [Measuring P&L](#measuring-pl)
- [Simulator](#simulator)
- [Stack](#stack)
- [Hosting and shutdown](#hosting-and-shutdown)
- [Project layout](#project-layout)
- [Hackathon requirements](#hackathon-requirements)
- [Roadmap](#roadmap)
- [Open questions](#open-questions)
- [Resources](#resources)

---

## Quick start

Requires Node 24+.

```bash
npm install
npm test               # unit tests
npm run price          # live reference prices for USD₮/ARS and USD₮/BRL
npm run sim            # backtest on the last 30 days of real wARS prices
npm run sim -- --sweep # compare spreads
npm run sim -- --data devaluation --sweep
```

Example `npm run price` output:

```
USDT/ARS
  ✓ coingecko:argentine-peso      1614.8045  (17s old)
  ✓ criptoya:usdt/ars             1616.5775  (22s old)
  ✗ dolarapi:cripto               stale (4127s old)
  → reference: 1615.6910
```

---

## What it does

The agent works like an **on-chain exchange house**. It rests buy orders below and sell orders above the market reference price on Textile, and earns the difference (the *spread*) when other participants take them.

An **LLM supervisor** tunes the strategy (spread, size, pause) based on market conditions and records its reasoning for every decision.

The subtrack is judged on three criteria, and the design targets each one:

| Criterion | How we address it |
|---|---|
| **Strategy P&L** | Spread capture, inventory control, and pausing during volatility |
| **Volume quoted and filled** | Small, frequent orders on both sides of the book |
| **Originality** | An LLM supervisor with explainable decisions, focused on LatAm currencies |

---

## Concepts: market making and the spread

**Example:** the "real" dollar is at 1,600 ARS. The agent rests:

| Order | Price | Who takes it |
|---|---|---|
| **Bid** (buy USD₮) | 1,584 | Someone who needs pesos and sells USD₮ |
| **Ask** (sell USD₮) | 1,616 | Someone who needs dollars |

If both fill, the agent bought 1 USD₮ at 1,584 and sold it at 1,616. It earned **32 ARS without betting on the price direction**.

### Directional trading vs. market making

| | Directional trading | Market making |
|---|---|---|
| How it earns | Predicting price direction | Capturing the spread |
| Orders | One side | Both sides |
| Main risk | Being wrong on direction | Inventory / adverse selection |
| Volume | Low | High |

### The real risk: inventory and adverse selection

If the dollar jumps from 1,600 to 1,750, everyone buys the agent's USD₮ at 1,616, and the agent is left holding pesos that are now worth less. Mitigations:

1. **Refresh the reference price** often and move orders when the market moves.
2. **Inventory skew**: when the agent holds too much of one currency, it shifts its prices to offload it.
3. **Widen the spread or pause** during volatility (a supervisor decision).

As a complement, if Textile drifts far from the reference (e.g. 1,550 vs 1,600), the agent can take liquidity directly (**arbitrage**).

---

## Why the LLM doesn't trade directly

An LLM takes seconds to respond, costs money per call, and is non-deterministic. So it **stays out of the fast order loop**. The design has two layers:

- **Quoting engine (deterministic code)**: runs every block and computes, places and cancels orders. Fast and predictable.
- **Supervisor (LLM)**: runs every ~10 minutes or on an alert. It acts as the "desk head": it tunes parameters but never trades.

The context makes this design work:

- Celo has ~1 second blocks, so this is not a microsecond game.
- Textile is a young market with little bot competition. The main risk is a lack of counterparties, not latency.
- wARS moves over minutes or hours outside of one-off events, which are exactly what the supervisor watches for.

If the LLM fails or times out, the engine keeps running on the last valid parameters. **The LLM is never on the critical path.**

---

## Architecture

```
                ┌──────────────────────────────────────────┐
                │      SUPERVISOR (LLM) · every ~10 min    │
                │  reads metrics → sets parameters →       │
                │  explains why                            │
                └───────────────┬──────────────────────────┘
                                │ validated params
 ┌──────────────┐   ref price   ▼                 ┌──────────────┐
 │ PRICE FEED   │──────────▶ QUOTING ENGINE ◀─────│ RISK MANAGER │
 │ CoinGecko,   │            (every block)        │ hard limits  │
 │ CriptoYa...  │                │                │ kill switch  │
 └──────────────┘                │ target         └──────▲───────┘
                                 ▼ orders                │
 ┌──────────────┐        ┌───────────────┐               │
 │ MARKET DATA  │───────▶│ ORDER MANAGER │───────────────┘
 │ Textile book │        │ place/cancel  │
 │ and fills    │        │ + attribution │
 └──────▲───────┘        │   tag         │
        │                └───────┬───────┘
        │                        ▼
        └────────────── CELO MAINNET · Textile ──────────────
                                 │
                 ┌───────────────┴────────────────┐
                 ▼                                ▼
          ┌────────────┐                  ┌──────────────┐
          │  STORAGE   │─────────────────▶│ TELEGRAM BOT │
          │ SQLite:    │                  │ status, P&L, │
          │ fills, P&L,│                  │ /pause, /off │
          │ decisions  │                  │ /why         │
          └────────────┘                  └──────────────┘
```

---

## Modules

### 1. Price Feed: reference price ✅

`src/feeds/`

- Queries independent sources in parallel with a timeout:

  | Source | Pairs | What it measures |
  |---|---|---|
  | CoinGecko | ARS, BRL | wARS / wBRL token price |
  | CriptoYa | ARS, BRL | Median mid price across ~15 exchanges' USD₮ books |
  | DolarAPI | ARS | "Dólar cripto" rate |

- Drops invalid and **stale** quotes (older than 30 min), then **outliers** (more than 3% off the median), then takes the **median** of the rest.
- At least 2 agreeing sources are required. Otherwise there is no price, and the agent cancels all orders. Trading without a trustworthy price is the fastest way to lose money.
- The reported timestamp is that of the **oldest** input, so the reference is never fresher than its weakest source.

### 2. Market Data: Textile state

- Reads the order book and detects our own fills.
- The implementation (API or contract events) depends on Textile's integration surface. See [Open questions](#open-questions).

### 3. Quoting Engine ✅

`src/engine/`

A pure function: `(refPrice, params, inventory) → target orders`.

```
bid = ref × (1 − spread/2 − skew)
ask = ref × (1 + spread/2 − skew)
```

- **Skew** is proportional to the inventory imbalance. With excess USD₮, both prices move down, so the agent sells more and buys less.
- Skew is **capped at spread/4**, so the side pulled toward the reference always keeps at least a quarter of the spread as edge. It never quotes at or through the reference.
- At full imbalance (target ± `inventoryBand`), the overweight side stops quoting.
- Sizes are limited by available balances, and orders under 1 USD₮ are dropped.
- Having no I/O makes it trivial to test, and the simulator reuses it as-is.

**Parameters** (`src/engine/params.ts`). The supervisor proposes them, and `clampParams` forces them into hard bounds:

| Param | Default | Bounds | Meaning |
|---|---|---|---|
| `spread` | 2% | 0.5%–10% | Full bid-ask width |
| `orderSize` | 10 USD₮ | 1–500 | Size per order |
| `maxSkew` | 1% | 0–5% | Max price shift at full imbalance (further capped at spread/4) |
| `targetBaseShare` | 50% | 10%–90% | Desired share of inventory value held in USD₮ |
| `inventoryBand` | 35% | 5%–45% | Deviation from target at which the overweight side stops |
| `paused` | false | | Quote nothing |

### 4. Order Manager: on-chain execution

- Diffs resting orders against target orders and only cancels or replaces when the difference exceeds a threshold, to save gas.
- **Appends the attribution tag (ERC-8021) to every transaction** through a single wrapper around `viem` (using `@celo/attribution-tags`), so no transaction can go out untagged.
- Handles nonces and retries, and pays gas in CELO or USD₮ via Celo fee abstraction. USD₮ has **6 decimals** on Celo and uses an adapter address for `feeCurrency`, while the wFiat tokens use 18.
- **Cancels all open orders on startup**, so orders left behind by a crash never sit at stale prices.

### 5. Risk Manager: hard limits

- Max order size, max inventory per currency, and max daily loss.
- Allowed ranges for every supervisor parameter (`clampParams`).
- **Kill switch**: on a large loss or a dead reference price, it cancels everything and alerts on Telegram.

### 6. Supervisor (LLM): desk head

- Runs every ~10 minutes, or early on an alert (volatility, loss).
- Input: a summary of volatility, P&L, inventory, recent fills, and the gap between Textile and the reference.
- Output: JSON validated with `zod`, then clamped by the Risk Manager:

```json
{ "spread": 0.025, "orderSize": 50, "paused": false,
  "reason": "ARS volatility 2x vs yesterday, widening spread" }
```

- Every decision is stored with its reasoning, as evidence of autonomy for the judges.

### 7. Storage: SQLite

Orders, fills, P&L snapshots and supervisor decisions. It backs the Telegram bot and the submission metrics.

### 8. Telegram Bot: control panel

- `/status`: inventory, P&L, open orders
- `/pause` and `/resume`: stop or resume quoting without stopping the process
- `/off`: triggers the [OFF function](#off-function-graceful-shutdown), which cancels everything and stops the agent
- `/why`: the supervisor's latest decision, explained
- Automatic alerts: fills, kill switch, strategy changes, heartbeat

### 9. ERC-8004 identity

A one-off script that registers the agent's wallet and identity in the ERC-8004 Identity Registry (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on Celo mainnet). It is not part of the loop.

---

## Measuring P&L

```
P&L = value_now(inventory) − value_start(inventory) − gas − fees
```

Both values are in USD₮ at the reference price. Measuring *mark-to-market* matters: counting only "spread earned" would hide inventory losses.

We also report **P&L vs. hold**, which compares the result to doing nothing with the starting inventory. During a devaluation both can go negative in USD₮ terms, but the strategy should still beat holding.

---

## Simulator

`sim/`. It backtests the real quoting engine on:

- **`history`**: hourly wARS prices from CoinGecko (last N days)
- **`calm` / `volatile` / `devaluation`**: synthetic random walks with optional devaluation jumps

```bash
npm run sim -- --data history --days 30 --spread 0.02 --size 10 --capital 100
npm run sim -- --data devaluation --sweep --seed 3
```

Options: `--pair`, `--days`, `--seed`, `--spread`, `--size`, `--skew`, `--capital`, `--taker-rate`, `--decay`, `--gas`, `--fee`, `--requote`, `--sweep`.

### ⚠️ The fill model is an assumption

There is no historical Textile order flow yet, so fills come from two rules:

1. **Crossing (adverse)**: if the reference moves through our price, an arbitrageur takes the stale order. These fills lose money.
2. **Organic takers**: each hour, a taker hits each side with probability `takerRate × e^(−decay × distance%)`.

The default `takerRate` is a placeholder, and **absolute P&L numbers from the simulator should not be trusted**. Use it to compare strategies and parameters against each other, and to check behavior under stress such as devaluations. The model will be calibrated once real Textile volume is known.

---

## Stack

| Piece | Technology |
|---|---|
| Language | TypeScript + Node 24 |
| Blockchain | [`viem`](https://viem.sh) + [`@celo/attribution-tags`](https://github.com/celo-org/attribution-tags) |
| Celo reference | [Celopedia skill](https://celopedia.celo.org) in `.claude/skills/` (verified addresses, ERC-8004, fee abstraction) |
| LLM | [NVIDIA Build](https://build.nvidia.com) via the `openai` SDK (OpenAI-compatible API) |
| Validation | `zod` |
| Database | SQLite (`better-sqlite3`) |
| Telegram | `grammY` |
| Tests | `vitest` |

### LLM: NVIDIA Build

NVIDIA Build exposes an OpenAI-compatible API, so we use the official `openai` SDK with a different `baseURL`:

```ts
import OpenAI from "openai";

const llm = new OpenAI({
  baseURL: process.env.LLM_BASE_URL, // https://integrate.api.nvidia.com/v1
  apiKey: process.env.LLM_API_KEY,
});
```

- The supervisor makes only a few calls per hour, well within free-tier limits.
- The provider sits behind `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`, so switching providers (Claude, OpenAI, …) is configuration only.
- Output is always validated with `zod`. Invalid output gets one retry, and if that also fails the previous parameters are kept.

---

## Hosting and shutdown

| Stage | Where | Notes |
|---|---|---|
| Development and simulation | **Local PC** | Free, no limits |
| First mainnet runs | **Local PC** | Disable sleep |
| Final week (24/7) | **Local** or [Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) | The Oracle VM is free and runs 24/7 |

> No Vercel or serverless: the agent is a **long-running process**, not a set of short functions.

**Risk of running locally:** if the machine goes down, orders stay on the book at stale prices. No single safeguard covers every case, so several layer together.

### OFF function (graceful shutdown)

A single `shutdown()` winds down operations:

1. Stops the engine and supervisor loops, so no new orders go out.
2. **Cancels all open orders** on Textile and waits for on-chain confirmation.
3. Saves a final inventory and P&L snapshot to SQLite.
4. Notifies on Telegram ("🔴 Agent stopped, 0 open orders") and exits.

It is idempotent, so a second trigger is a no-op. It also has a timeout so it never hangs on a dead network, and in that case it warns that orders may still be open.

Triggers:

| Trigger | When |
|---|---|
| `Ctrl+C` (`SIGINT`) | Stopping the process from the terminal |
| `SIGTERM` | The OS or host stops the process |
| `SIGHUP` | The console window is closed (Windows) |
| `/off` on Telegram | Remote shutdown from a phone |
| Kill switch | The Risk Manager detects a large loss or a dead reference price |
| Unhandled error | `uncaughtException` / `unhandledRejection` |

### What the OFF function can't cover

A power cut, a system freeze or `kill -9` gives the process no chance to run anything. For those cases:

1. **Cancel all open orders on startup**, before quoting.
2. **Short order expiry**, if Textile supports it. This is the only safeguard that works while the process is dead.
3. **Telegram heartbeat**: if it stops arriving, the process is down and orders can be cancelled by hand in the Textile app.
4. **Bounded exposure**: the max order size caps what orphaned orders can lose.

P&L and volume are measured on real activity, so ideally the agent trades **for at least the entire final week** before the deadline.

---

## Project layout

```
textile-mm-agent/
├── src/
│   ├── lib/          # shared helpers (median, clamp)                      ✅
│   ├── feeds/        # price feed: sources, aggregation, pair config       ✅
│   ├── engine/       # quoting engine and parameter bounds (pure)          ✅
│   ├── market/       # Textile book and fills
│   ├── orders/       # order manager + attribution tag wrapper
│   ├── risk/         # limits and kill switch
│   ├── supervisor/   # LLM + zod schema
│   ├── bot/          # Telegram
│   ├── db/           # SQLite
│   ├── lifecycle/    # startup (cancel orphans) and OFF function
│   └── main.ts       # main loop
├── sim/              # backtester: price data, fill model, CLI           ✅
├── scripts/          # price check ✅, ERC-8004 registration, balances
├── test/             # vitest suites                                     ✅
└── .claude/skills/   # Celopedia skill for coding agents
```

---

## Hackathon requirements

- [x] Enrolled on [Loops House](https://www.loops.house/agents-on-open-rails) and got the **attribution tag**
- [ ] **Attribution tag (ERC-8021)** in the calldata of **every** transaction ([attribution-tags](https://github.com/celo-org/attribution-tags)). Untagged transactions can't be credited later.
- [ ] Agent's **ERC-8004 identity** registered before the deadline ([docs](https://docs.celo.org/build-on-celo/build-with-ai/8004) · [8004scan](https://8004scan.io))
- [ ] Trades on **Celo mainnet** (chain id `42220`). Testnet transactions don't count.
- [ ] **Public GitHub repo** from enrollment through judging
- [x] Code written during the hackathon

**Dates**

| Date | Event |
|---|---|
| Mon 9 Nov, 09:00 GMT | Registration and submission deadline |
| Fri 13 Nov | Winners announced |

---

## Roadmap

### Week 1: foundations and simulation
- [x] Project setup (TypeScript, vitest)
- [x] Price feed with multiple sources and median
- [x] Quoting engine with tests
- [x] Simulator on historical and synthetic prices
- [x] Enrollment and attribution tag
- [ ] ERC-8004 registration
- [ ] Find out how to integrate with Textile

### Week 2: on-chain
- [ ] Market data (Textile book and fills)
- [ ] Order manager with attribution tag
- [ ] Risk manager and kill switch
- [ ] OFF function and cancel-on-startup
- [ ] First real orders on mainnet with minimal sizes

### Week 3: agent and submission
- [ ] LLM supervisor (NVIDIA Build)
- [ ] Telegram bot
- [ ] Continuous mainnet operation to build up P&L and volume
- [ ] Final README, metrics and demo video

---

## Open questions

For the [hackathon Telegram](https://t.me/realworldagentshackathon):

- Does Textile have an API or SDK, or do we interact with the contracts directly? Where are the addresses and ABIs?
- How are limit orders placed and cancelled? Do they support expiry?
- How much liquidity and volume do wARS/USD₮ and wBRL/USD₮ have today?
- Are there maker or taker fees?

---

## Resources

**Hackathon and Celo**
- Hackathon: https://www.loops.house/agents-on-open-rails
- Celo docs: https://docs.celo.org
- Celopedia: https://celopedia.celo.org (`npx skills add celo-org/celopedia-skills`)
- ERC-8004: https://docs.celo.org/build-on-celo/build-with-ai/8004
- Attribution tags: https://github.com/celo-org/attribution-tags

**Textile, stablecoins and ramps**
- Textile FX: https://app.textilecredit.com
- Ripio docs: https://docs.ripio.com
- Ripio ramp: https://ramp.ripio.com
- Ripio bridge: https://bridge.ripio.com
- USD₮ faucet (mainnet): https://cloud.google.com/application/web3/faucet/celo/mainnet

**Token addresses** (Celo mainnet)

| Token | Address | Decimals |
|---|---|---|
| wARS | `0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d` | 18 |
| wBRL | `0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0` | 18 |
| USD₮ | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | 6 |
| USD₮ fee adapter | `0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72` | |

**Support**
- Telegram: https://t.me/realworldagentshackathon
- Office hours: Thursdays 12:00 GMT
