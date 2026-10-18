# Agent context: Textile MM Agent

Handoff notes for coding agents working on this repo. Read this first, then `README.md` (architecture and design).

Last updated: 2026-10-17.

## The user

- Speaks Spanish (Argentina). **Explain things in Spanish; write code, comments, commits and the README in English.**
- Knows how to program, but is new to crypto, DeFi and market making. Explain domain concepts briefly when they come up.
- On Windows 11. Use the Write/Edit tools for files: multi-line bash heredocs have failed in this environment.

## The project

An autonomous, LLM-supervised **market maker for Textile FX** on **Celo mainnet**, quoting wARS/USD₮ (and later wBRL/USD₮).

- Hackathon: [Agents on Open Rails](https://www.loops.house/agents-on-open-rails) (Celo)
- Track: **Stable Agents: Open Corridors → Textile FX** subtrack ($750 first, $250 second)
- Judged on: **strategy P&L, volume quoted and filled, originality**
- **Deadline: Mon 9 Nov 2026, 09:00 GMT (06:00 ART).** Winners announced Fri 13 Nov.
- Repo: https://github.com/ignaher12/textile-mm-agent (public, required by the rules)

### Hackathon hard requirements

| Requirement | Status |
|---|---|
| Enrolled on Loops House, attribution tag obtained | ✅ tag in `.env` (`ATTRIBUTION_TAG`) |
| ERC-8021 attribution tag on every transaction | ✅ enforced by `createAgentWallet()` in `src/chain/wallet.ts` |
| ERC-8004 identity registered | ✅ agentId **9972** ([tx](https://celoscan.io/tx/0xead3c3e993ee2fdb11e383240032d68e1599f27034cda9d351057642edc68148)) |
| Transactions on Celo mainnet (testnet doesn't count) | ✅ first tx sent (the ERC-8004 registration, tagged) |
| Public GitHub repo | ✅ |
| Code written during the hackathon | ✅ |

## Current state

**Done** (43 tests passing, `npm test`):

- `src/feeds/`: reference price from CoinGecko, CriptoYa and DolarAPI, with staleness and outlier filtering and median aggregation. `npm run price`
- `src/engine/`: pure quoting engine (bid/ask around ref, inventory skew capped at spread/4) with clamped parameters
- `sim/`: backtester on CoinGecko history and synthetic scenarios. `npm run sim -- --sweep`
- `src/chain/`: Celo token addresses, public client, attribution-tagged wallet client
- `scripts/new-wallet.ts`: agent wallet generator (key goes to `.env`, never printed; refuses to overwrite)
- `scripts/balances.ts`: `npm run balances`
- `scripts/register-identity.ts`: ERC-8004 registration, dry run by default
- `src/feeds/sources/textile.ts`: Textile's own price endpoint as a 4th source (inverted to local currency per USD₮)
- `scripts/approve-permit2.ts`: `npm run approve -- --token USDT|wARS|wBRL [--send]`. Max Permit2 allowance from our wallet (USD₮ gas, tagged). **USD₮ approved** 2026-10-17 ([tx](https://celoscan.io/tx/0xb0d87848090f3149f2c597dee02fc87ae74778c1e0349da9e9ee2ea82341169d)).
- `src/stitch/`: HTTP feed server for Stitch (`npm run feed`, `GET /price?pair=wars-usdt|wbrl-usdt`). It publishes `1 / (ref × (1 − skew))` in Stitch's format, uses `degraded: true` for pause, and answers 503 when there is no price. Skew is still a stub (0), not yet wired to live inventory.

**Agent wallet:** `0x78D8e34A3b47e0dBAc0930e3F58f3FC623bEdce3`. It holds **4.937 USD₮** and 0 CELO, so gas is paid in USD₮ via fee abstraction (`feeCurrency: USDT_FEE_CURRENCY`). The private key lives only in `.env`, which is git-ignored.

**ERC-8004 identity: agentId 9972**, registered 2026-10-17 from the agent wallet (cost ≈ 0.011 USD₮). The calldata carries the attribution tag and the ERC-8021 suffix.

## Key findings about Textile (they change the README's original design)

Docs: https://docs.textilecredit.com (same content at https://fx-docs.textilecredit.com).

- **Textile is RFQ-based, not a resting order book.** A trader requests a quote, and online makers ("**fillers**") have ~1 s to answer with a **signed EIP-712 order**, exclusive to that trader and valid ≤ 60 s. The **trader** broadcasts the settlement transaction and pays gas.
  - Quoting is **off-chain and gasless** for the filler. Only one-time Permit2 approvals cost gas.
  - Stale-order risk is small, since quotes expire within 60 s.
  - Taker fee is 1 bps on Celo. Makers pay no fee.
- Textile also has gasless trader **limit orders** (5 min to 1 year expiry; cancelling costs gas). Fillers can optionally take them.
- **The maker-side protocol is not publicly documented.** The only implementation is **Stitch**, Textile's official filler bot: https://github.com/textile-protocol/textile-stitch (Rust, AGPL-3.0).
  - Stitch reads an external price feed URL returning `{ "price": ..., "timestamp": <unix seconds> }`.
  - Spreads are in bps in `stitch.toml`. Config is read at startup, so spread changes require a restart.
  - It has no inventory skew ("no inventory lean").
  - Onboarding: `stitch approve`, then "Connect to Textile" (signs with the wallet plus an email verification).
- **Celo contracts** (address book):
  - LimitOrderReactor `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3`
  - Fee controller `0x7b005466F905DD882A959888154587fA76cd3Ea7`
  - Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`
  - OperatorVaultFactory `0x88104decA449C797632AfdcA77A3140b24cD844A`
  - VaultOrderExecutor `0x01b006d5c687bde182aa36F542f1f014144742e2`
- **Live market** (public feed `https://api.textilecredit.com/tickers`, checked 2026-10-17):
  - **USD₮/wARS**: bid **0** (empty), ask 1616.53, **24h volume 0**. Nobody makes a two-sided wARS market.
  - **But wARS has real history** (`GET /historical_trades?ticker_id=USDT_WARS&limit=1000`, timestamps in seconds): ~1,230 fills and ~251k USD₮ since 2026-07-15, on both sides (buy 126k, sell 126k). Late Sep to mid Oct ran ~1–7k USD₮/day; the last fill was 2026-10-16. Two ~60k days (Sep 4 and 6) are outliers. The ticker's "24h volume 0" is just a quiet day, and "bid 0" means one side's maker went dark (likely ran out of inventory). wBRL `historical_trades` currently errors ("Failed to build historical trades").
  - **USD₮/wBRL**: bid 5.0787, ask 5.0812 (~0.05% spread), 24h volume ~600 USD₮. One competitive maker already exists.
- **The simulator is miscalibrated.** Its default 2% spread and taker-flow model are far from Textile reality, where spreads are in basis points and wARS flow is near zero. Use it only for relative comparisons until it is recalibrated.

## Stitch findings (read from source, commit dcac283, 2026-10-16)

- Textile already ships a **`wars-usdt-celo` corridor** (template `src/setup/templates/wars-usdt-celo.toml`). wARS is the *collateral* (soft asset, 18 dp), USD₮ the *debt* (6 dp). Reactor on Celo: `0xa9AA…35b3`.
  - **buy side** = pay USD₮, receive wARS (needs USD₮ + Permit2 on USD₮). We can run this today.
  - **sell side** = sell wARS for USD₮ (needs wARS + Permit2 on wARS). This is the empty side of the market.
- **Feed format:** `{ price, timestamp, degraded? }`. `price` is **USD₮ per token** (~0.00062 for wARS). `timestamp` is integer Unix seconds and must never be ahead of the bot clock. `degraded: true` stops quoting **without a restart**, so it is our pause/kill-switch hook. A failed fetch clears Stitch's cache, so it fails closed.
- Textile's default feed is `https://api.textilecredit.com/price?chainId=42220&pair=wars-usdt` (also `wbrl-usdt`). We use it as one of our sources.
- Spreads: `buy_offset_bps` / `sell_offset_bps`, set **per side**. The corridor default is 1 bps. They are read at startup, so changes need a restart.
- **RFQ has no inventory lean.** Stitch's `lean_*` options only apply to the ladder and the limit-order taker, so publishing a skewed price is still our edge. RFQ capacity is `min(balance, Permit2 allowance)`; `*_min_slice_debt` is ladder sizing.
- Onboarding: `stitch connect` signs a registration and writes `rfq-api.key` (the user must do this, it may ask for email). If Textile hasn't "seated" the corridor for us it says so: ask Textile.
- **Stitch has no Celo fee abstraction** (no `feeCurrency`), so its `stitch approve` needs native CELO. We hold 0 CELO, so do the Permit2 approvals **with our own wallet** (USD₮ gas plus the attribution tag) instead.
- Windows: `irm https://github.com/textile-protocol/textile-stitch/releases/latest/download/stitch-installer.ps1 | iex`, or the desktop app (panel on `127.0.0.1:8420`).

## Decision: execution via Stitch (option A)

Decided with the user on 2026-10-17:

- **Option A (chosen): Stitch as the execution layer, with our agent on top.** Our price feed becomes Stitch's feed URL. We inject inventory skew and supervisor adjustments through the published price, and the LLM supervisor tunes spreads (config plus restart). This is the fastest path to mainnet volume.
- **Option B (rejected for now): our own TypeScript filler.** Requires reverse-engineering the maker protocol from Stitch's source. More control, but riskier with ~3 weeks left.

Also decided: **start with wARS**. There is no competition and the "two-sided liquidity for the Argentine peso" story is strong.

## Open questions

Checked against docs.textilecredit.com on 2026-10-17. The docs answer only part of them:

- **Onboarding/seating (answered):** per the filler guide (https://fx-docs.textilecredit.com/guides/how-to-become-a-filler.html), seating is **self-serve**: Settings → RFQ → Connect to Textile, click the emailed verification link (covers every corridor and chain), then Check status. The bot seats itself on its pair's corridors within a minute. Contact contact@textilecredit.com only if the panel reports a blocked maker or an unsupported pair.
- **Limit-order taking costs native gas.** The guide says to leave "Fill users' resting limit orders" on, but Stitch can't pay gas in USD₮ and we hold 0 CELO, so keep it **off** until we hold CELO.
- **Maker protocol (answered: not documented):** the v2 API documents only the trader side (`/v2/rfq/request`, `/submit`, …). The maker stream is only in Stitch's source. The docs only describe Stitch.
- **Settlement (partly answered):** the taker broadcasts the swap; Textile never broadcasts. The reactor is UniswapX `LimitOrderReactor` v2.1.0, so on-chain our wallet appears as the order **swapper** (signer) in the `Fill` event, and the taker as the filler/msg.sender. Our ERC-8021 tag is not in that tx.
- **Steering (answered):** traders can send `restrictedLiquidityWallets` / `preferredLiquidityWallets` (≤ 10 Stitch operator addresses, no credential needed) to `/v2/rfq/preview` and `/request`. Useful for an end-to-end test against our own maker; don't count self-routed trades as volume (that's wash trading).
- **Monitoring (answered):** `/historical_trades` gives per-fill `trade_id` = tx hash + log index, so we can match our fills on-chain (Fill event swapper = our wallet). No per-maker API.
- **Testnet:** only cNGN corridors (BSC testnet, Base Sepolia). No wARS testnet.
- **Ramps:** the deposit/withdrawal partners page only covers NGN ↔ cNGN. Getting wARS is not documented.
- **Still open (ask the hackathon organizers, not Textile):** how judges credit a maker's volume and P&L when the taker sends the tx and our tag isn't in it; whether Stitch plus our own feed and supervisor counts as originality; whether wARS taker flow is expected.

## Stack and decisions already made

- TypeScript (strict, NodeNext), Node 24, `viem`, `zod`, `vitest`, `tsx`. TypeScript 7.
- LLM: **NVIDIA Build** (free credits), via the `openai` SDK with `LLM_BASE_URL=https://integrate.api.nvidia.com/v1`. Provider-agnostic through env vars.
- The LLM is a **supervisor** that sets parameters every ~10 min. It is never in the fast loop, and its output is validated with zod and clamped by `clampParams`.
- Hosting: **local PC** for now. Oracle Cloud Always Free is the option for 24/7 in the final week. No serverless.
- **OFF function** (user request): a graceful `shutdown()` that stops the loops, cancels everything, snapshots and notifies Telegram. Triggers are SIGINT/SIGTERM/SIGHUP, `/off`, the kill switch and unhandled errors. Pair it with cancel-on-startup and a heartbeat. See the README.
- Planned: SQLite storage, grammY Telegram bot (`/status /pause /resume /off /why`).
- Celo reference: the Celopedia skill in `.agents/skills/` (symlinked into `.claude/skills/`). Notes: USD₮ has 6 decimals and needs the fee adapter `0x0e2a…6f72`, and wFiat tokens have 18 decimals.

## Working rules

- **Never print, log or commit the private key.** `.env` is git-ignored. Don't paste secrets in chat.
- **Confirm with the user before any mainnet transaction**, especially irreversible ones.
- Run `npx tsc --noEmit` and `npm test` before committing.
- End commit messages with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (when the agent is Claude).
- On Windows, `gh` lives at `"/c/Program Files/GitHub CLI/gh.exe"` (logged in as `ignaher12`, git credential helper configured).

## Suggested next steps

1. ~~ERC-8004 registration~~ done (agentId 9972).
2. ~~Feed server for Stitch~~ done. USD₮ Permit2 done. Stitch v0.1.321 unpacked in `C:\Users\ignah\Stitch`. Next: user sets up the desktop app and emails Textile for seating, lower `PARAM_BOUNDS.spread` to bps, wire live inventory into the skew.
3. Acquire wARS **outside Textile** (Ripio ramp or another Celo DEX): the side of the Textile book that would sell us wARS is empty. Without wARS the agent can't quote the empty bid side. Budget is tiny: 4.937 USD₮ so far.
4. Update the README architecture for the RFQ/filler model, and recalibrate the simulator to bps spreads.
5. Week 2–3: risk manager, OFF function, supervisor (NVIDIA Build), Telegram bot, then continuous mainnet operation for at least the final week.
