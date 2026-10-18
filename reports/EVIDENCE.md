# Evidence: Textile MM Agent on Celo mainnet

Generated 2026-10-18 17:25:39.408Z by `npm run report` from the agent's own logs and on-chain data.

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

- Period: 2026-10-18 04:09:11.125Z → 2026-10-18 17:23:18.657Z (13.2 h, 79 samples every 5 min)
- Agent process up: **49.4%** of the period
- Quoting: **48.8%** of the period
- Quoted capacity × time: **15.71 USD₮·h** bidding for wARS, **14.62 USD₮·h** offering wARS

Why it wasn't quoting (samples):

- paused by the supervisor: 1

## Competitiveness

Average distance from our reference while quoting, read from outside with restricted RFQ previews (~2 USD₮ probe).

| Side | Ours | Best maker |
|---|---|---|
| We bid for wARS (trader sells wARS) | 19.6 bps | -0.2 bps |
| We offer wARS (trader buys wARS) | 20.4 bps | 1.0 bps |

## P&L (mark-to-market, in USD₮ at our reference)

| | |
|---|---|
| Inventory value at start | 4.9345 USD₮ |
| Inventory value now | 4.9328 USD₮ |
| **P&L** | **-0.0016 USD₮** |
| Holding the inventory instead (switched to the new mix after our own swaps, at equal value) | 4.9328 USD₮ |
| **P&L vs hold** | **0.0000 USD₮** |

Balances are read from the chain, so gas and fees are already in these numbers.
It also includes the spread the maker earned on our own self-test fills (see Fills).

## Fills (0 from real takers, 3 self-test)

Self-tests are trades from our own throwaway wallet against our maker, to check fills end to end. They are not volume.

- block 80441733, taker `0x5E9829C7620aa05B3d25CD9294740C04077aC3fF`: [tx](https://celoscan.io/tx/0x2dd3f5c041a7ca0d86c44ba1bdeab9a539cd26d759b0578ee7e2d72299a7e782) **(self-test, not volume)**
- block 80441976, taker `0x5E9829C7620aa05B3d25CD9294740C04077aC3fF`: [tx](https://celoscan.io/tx/0x29dac696bc9e527ac617123105fd6e785859e9c1011383b02a1b7cb7b9afe49d) **(self-test, not volume)**
- block 80442006, taker `0x5E9829C7620aa05B3d25CD9294740C04077aC3fF`: [tx](https://celoscan.io/tx/0x7869c742fbc71ce2f8d1824fc0f46f3d5daa17b20aef4fcb63207729376063d4) **(self-test, not volume)**

## Supervisor (LLM)

- Calls: 47 (40 valid, 7 failed and ignored)
- Policy changes applied: 2
- Full log with the context of each call: `data/decisions.jsonl`

Latest decisions:

- **2026-10-18 16:43:53.181Z**: Our bid and offer are about 20 bps away from the market best, but our quoted capacity (~2.5 USDT) is far below the typical ~100 USDT trade size, so tightening the spread would not improve fill probability; we keep the current settings. _(spread rec.: 20 bps/side)_
- **2026-10-18 16:53:56.575Z**: Our quoted capacity (~2.5 USDT) is far below the typical ~100 USDT trade size, so tightening the spread or adjusting inventory parameters would not improve fill probability; we keep current settings. _(spread rec.: 20 bps/side)_
- **2026-10-18 17:03:58.362Z**: Our quoted capacity (~2.5 USDT) is far below the typical trade size (~100 USDT), so tightening the spread or adjusting inventory parameters would not improve fill probability; the market shows no disorderly moves or data issues. _(spread rec.: 20 bps/side)_
- **2026-10-18 17:14:04.916Z**: Our bid and offer are about 20 bps away from the market best, but our quoted capacity (~2.5 USDT) is far below the typical ~100 USDT trade size, so tightening the spread or adjusting inventory parameters would not improve fill probability; the market shows no disorderly moves or data issues. _(spread rec.: 20 bps/side)_
- **2026-10-18 17:23:35.914Z**: Market shows no disorderly moves or data issues; our quoted capacity (~2.5 USDT) is far below typical trade size (~100 USDT), so adjusting spreads or inventory parameters would not improve fill probability. _(spread rec.: 20 bps/side)_
