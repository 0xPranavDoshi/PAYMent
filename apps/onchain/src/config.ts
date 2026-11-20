// Arc Testnet + reward configuration for the on-chain service.

/** Arc Testnet chain + Circle constants (verified against developers.circle.com + docs.arc.network, 2026-11). */
export const ARC_TESTNET = {
  /** Chain name the @circle-fin/x402-batching SDK expects. */
  chainName: "arcTestnet",
  chainId: 5042002,
  /** x402 `network` string. */
  x402Network: "eip155:5042002",
  rpcUrl: "https://rpc.testnet.arc.network",
  explorer: "https://explorer.testnet.arc.io",
  /** USDC on Arc Testnet. Gas is also paid in USDC (native, 18 decimals). */
  usdcAddress: "0x3600000000000000000000000000000000000000",
  /** Circle Wallets / CCTP blockchain enum. */
  circleBlockchain: "ARC-TESTNET",
  /** CCTP / Gateway domain id. */
  gatewayDomainId: 26,
} as const;

/** Link to an address or tx on the Arc Testnet explorer. */
export const explorerAddress = (a: string) => `${ARC_TESTNET.explorer}/address/${a}`;
export const explorerTx = (h: string) => `${ARC_TESTNET.explorer}/tx/${h}`;

/**
 * Reward sizing: a creator earns REWARD_RATE of the USDC a follower put on their pick,
 * with a REWARD_MIN_USDC floor so a $1 paper tail still produces a visible micropayment.
 */
export const REWARD_RATE = 0.02; // 2%
export const REWARD_MIN_USDC = 0.01; // 1 cent floor

/**
 * Daily revenue share: the fee taken from each follower trade that settled in profit, credited to
 * the pick's creator (if opted in from a previous day) or kept by the treasury. Default 0.7%.
 */
export const PAYOUT_FEE_RATE = Number(process.env.PAYOUT_FEE_RATE ?? 0.007);
