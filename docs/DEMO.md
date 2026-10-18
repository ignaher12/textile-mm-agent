# Demo video script

Target length: about 3 minutes. Six scenes, each with what to show and what to say.
Record the screen at 1080p and zoom the terminal font so text is readable.

**Before recording:**
- The agent (`npm start`) and Stitch are running and quoting.
- Telegram is open on the desktop (Telegram Desktop or web.telegram.org), next to the terminal.
- Tabs ready: the GitHub repo, `reports/EVIDENCE.md` on GitHub, the agent wallet on Celoscan, and the ERC-8004 registration tx.
- Run `npm run report` and push, so the evidence on GitHub is fresh.

---

## 1. The problem (0:00–0:25)

**Show:** the README header on GitHub, then the corridor table in "The wARS corridor: what the data says".

**Say:**
> Textile FX lets anyone trade Argentine pesos (wARS) against USD₮ on Celo. Prices come from market makers who answer each request for quote in about a second. When I looked at the data, the wARS corridor had real flow, about 250 thousand dollars since July, but one side has almost no liquidity: a single maker with about 47 dollars of depth, while trades come in 100-dollar clips. This is an autonomous agent that makes that market.

## 2. Architecture (0:25–0:55)

**Show:** the Architecture diagram in the README.

**Say:**
> The design has three layers, by speed. Stitch, Textile's filler bot, answers RFQs in milliseconds. Below it, my agent publishes the price Stitch quotes: a median of four sources, with an inventory skew Stitch doesn't have, and a risk manager that can pause quoting or trip a kill switch. On top, an LLM supervisor acts as the desk head: every ten minutes it reviews the market and sets the inventory policy, but it never trades and every decision is logged with its reasoning.

## 3. It's live (0:55–1:40)

**Show:** run `npm run status` in the terminal.

**Say, pointing at each block:**
> This is live on Celo mainnet. The wallet holds both currencies, so it quotes both directions. Here's our reference price against Textile's, a couple of basis points apart. And these are our live quotes, read from outside through Textile's own API, restricted to our wallet: about 20 basis points from mid on each side, next to the best maker in the market.

**Show:** in Telegram, send `/status`, then `/why`.

**Say:**
> I run it from Telegram. `/why` shows the supervisor's latest decision and its reasoning. Alerts arrive on their own: start and stop, pauses, policy changes and fills.

## 4. Safety (1:40–2:10)

**Show:** in Telegram, send `/pause`. In the terminal, show the agent log going to paused. Run `npm run status` (it shows paused). Then send `/resume`.

**Say:**
> Safety is in code, not in the model. Pausing marks the price feed as degraded, and Stitch stops quoting within a second, with no restart. The risk manager does this on its own on price jumps or a divergence from Textile's price, and a drawdown above 3% trips a kill switch that stays on until a human clears it. The supervisor can only pause for a disorderly market or bad data: once it tried to pause because there was little flow, so that's now rejected in code.

## 5. Evidence (2:10–2:40)

**Show:** `reports/EVIDENCE.md` on GitHub: Operation, Competitiveness, P&L. Then the wallet on Celoscan, and the registration tx (agentId 9972).

**Say:**
> The agent records everything: uptime, quoted capacity, our quotes against the best maker, and mark-to-market P&L against simply holding. Every transaction it sent carries the ERC-8021 attribution tag and pays gas in USD₮, and it has an ERC-8004 identity, agent 9972.

## 6. The honest result (2:40–3:00)

**Show:** the "Trade sizes vs our capacity" table in the README.

**Say:**
> The honest result: with about five dollars of capital it hasn't filled a trade yet, because every trade has been bigger than its inventory and Textile has no partial fills. But the data shows that with about 100 dollars of wARS, this agent would compete for most of the trades on the thin side, around 18 a day. The system is built and running; capital is the only missing piece. Thanks for watching.

---

## Tips

- Do one take per scene and join them. It's easier than a 3-minute single take.
- If a command is slow (`npm run status` takes ~10 s), cut the wait in editing.
- Never show `.env`, `stitch.key` or `rfq-api.key` on screen. The Stitch panel's wallet page shows the address only, which is fine.
