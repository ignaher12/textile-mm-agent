import { parseAbiItem, type Address, type Hash, type PublicClient } from "viem";

/** Textile's settlement reactor on Celo (UniswapX LimitOrderReactor). */
export const TEXTILE_REACTOR: Address = "0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3";

/**
 * UniswapX fill event. `filler` is whoever sent the settlement tx (the trader
 * on Textile RFQ); `swapper` is the order signer, i.e. the maker.
 */
export const fillEvent = parseAbiItem(
  "event Fill(bytes32 indexed orderHash, address indexed filler, address indexed swapper, uint256 nonce)",
);

/** forno.celo.org rejects eth_getLogs ranges above 5,000 blocks. */
export const MAX_LOG_RANGE = 5_000n;

export interface MakerFill {
  txHash: Hash;
  blockNumber: bigint;
  taker: Address;
}

/** Fills of orders signed by `maker` in [fromBlock, toBlock], scanned in RPC-sized chunks. */
export async function findMakerFills(
  client: Pick<PublicClient, "getLogs">,
  maker: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<MakerFill[]> {
  const fills: MakerFill[] = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE) {
    const end = start + MAX_LOG_RANGE - 1n < toBlock ? start + MAX_LOG_RANGE - 1n : toBlock;
    const logs = await client.getLogs({
      address: TEXTILE_REACTOR,
      event: fillEvent,
      args: { swapper: maker },
      fromBlock: start,
      toBlock: end,
    });
    for (const log of logs) {
      fills.push({ txHash: log.transactionHash, blockNumber: log.blockNumber, taker: log.args.filler! });
    }
  }
  return fills;
}
