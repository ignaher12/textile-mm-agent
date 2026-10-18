# Evidence: Textile MM Agent on Celo mainnet

Generated 2026-10-18 15:46:48.058Z by `npm run report` from the agent's own logs and on-chain data.

## Identity

- Agent wallet: [`0x78D8e34A3b47e0dBAc0930e3F58f3FC623bEdce3`](https://celoscan.io/address/0x78D8e34A3b47e0dBAc0930e3F58f3FC623bEdce3)
- ERC-8004 agentId **9972** ([8004scan](https://8004scan.io))
- Textile maker: `stitch-42220-78d8e34a` on the wars-usdt-celo corridor

## Transactions sent by the agent

Every one carries the ERC-8021 attribution tag (enforced by `createAgentWallet()`), and gas was paid in USD₮.

| What | Tx |
|---|---|
| ERC-8004 identity registration (agentId 9972) | [0xead3c3e9…](https://celoscan.io/tx/0xead3c3e993ee2fdb11e383240032d68e1599f27034cda9d351057642edc68148) |
| Permit2 approval, USD₮ | [0xb0d87848…](https://celoscan.io/tx/0xb0d87848090f3149f2c597dee02fc87ae74778c1e0349da9e9ee2ea82341169d) |
| Permit2 approval, wARS | [0x2493af79…](https://celoscan.io/tx/0x2493af79550153337f6dfeed3a41167c0abba474918d747cfc47ad0611dba9fa) |
| USD₮ approval to Textile's reactor (taker swap) | [0xa62db3c4…](https://celoscan.io/tx/0xa62db3c446f488e14d7c32f201d469e8e945b6ed13fccd35c4b09250e33b9ffa) |
| **Taker swap on Textile RFQ: 2.4 USD₮ → 3,877.96 wARS** | [0x75d82980…](https://celoscan.io/tx/0x75d829806c9df83a1486b291065d75a9771c3dac6bd423d9ff700ec1258288fd) |

## Operation

- Period: 2026-10-18 04:09:11.125Z → 2026-10-18 15:41:56.993Z (11.5 h, 58 samples every 5 min)
- Agent process up: **41.6%** of the period
- Quoting: **40.8%** of the period
- Quoted capacity × time: **11.19 USD₮·h** bidding for wARS, **10.62 USD₮·h** offering wARS

Why it wasn't quoting (samples):

- paused by the supervisor: 1

## Competitiveness

Average distance from our reference while quoting, read from outside with restricted RFQ previews (~2 USD₮ probe).

| Side | Ours | Best maker |
|---|---|---|
| We bid for wARS (trader sells wARS) | 19.6 bps | -0.1 bps |
| We offer wARS (trader buys wARS) | 20.4 bps | 1.0 bps |

## P&L (mark-to-market, in USD₮ at our reference)

| | |
|---|---|
| Inventory value at start | 4.9345 USD₮ |
| Inventory value now | 4.9263 USD₮ |
| **P&L** | **-0.0082 USD₮** |
| Holding the inventory instead (switched to the new mix after our own swaps, at equal value) | 4.9331 USD₮ |
| **P&L vs hold** | **-0.0069 USD₮** |

Balances are read from the chain, so gas and fees are already in these numbers.

## Fills (0)

None yet. Typical wARS trades are ~100 USD₮, above this deployment's capacity (see the README).

## Supervisor (LLM)

- Calls: 36 (30 valid, 6 failed and ignored)
- Policy changes applied: 2
- Full log with the context of each call: `data/decisions.jsonl`

Latest decisions:

- **2026-10-18 15:02:07.714Z**: Our capacity (~2.5 USDT) is far below typical trade size (~100 USDT), so quotes being far from the market best cannot be improved by tightening spread or adjusting skew; keeping current settings avoids unnecessary edge loss. _(spread rec.: 20 bps/side)_
- **2026-10-18 15:12:20.290Z**: Our capacity (~2.5 USDT) is far below typical trade size (~100 USDT), so quotes being far from the market best cannot be improved by tightening spread or adjusting skew; keeping current settings avoids unnecessary edge loss. _(spread rec.: 20 bps/side)_
- **2026-10-18 15:22:44.017Z**: Our capacity (~2.5 USDT) is far below typical trade size (~100 USDT), so quotes being far from the market best cannot be improved by tightening spread or adjusting skew; keeping current settings avoids unnecessary edge loss. _(spread rec.: 20 bps/side)_
- **2026-10-18 15:32:15.943Z**: Our capacity (~2.5 USDT) is far below typical trade size (~100 USDT), so quotes being far from the market best cannot be improved by tightening spread or adjusting skew; keeping current settings avoids unnecessary edge loss. _(spread rec.: 20 bps/side)_
- **2026-10-18 15:42:11.163Z**: Our capacity (~2.5 USDT) is far below typical trade size (~100 USDT), so quotes being far from the market best cannot be improved by tightening spread or adjusting skew; keeping current settings avoids unnecessary edge loss. _(spread rec.: 20 bps/side)_
