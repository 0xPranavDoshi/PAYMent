import { z } from "zod";

// On-chain workstream (Mugdha): wallet link, opt-in, x402 reward accrual, earnings, redeem.
// All amounts are USDC as plain numbers (not strings); timestamps are ISO strings.

/** An EVM address on Arc Testnet. */
export const EvmAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte EVM address");
export type EvmAddress = z.infer<typeof EvmAddress>;

/** Values stored in earnings_ledger.reason. */
export const EarningReason = z.enum(["tail_reward", "copy_reward", "redeem"]);
export type EarningReason = z.infer<typeof EarningReason>;

/**
 * POST /v1/auth/x/upsert — called by the website's X-login callback to create or
 * update the users row for the signed-in X account. Returns the user id used as
 * X-User-Id / X-Follower-Id by the extension and website.
 */
export const XUpsertRequest = z.object({
  xUserId: z.string().min(1),
  handle: z.string().min(1),
});
export type XUpsertRequest = z.infer<typeof XUpsertRequest>;

export const AuthUser = z.object({
  userId: z.string().uuid(),
  handle: z.string(),
  walletAddress: EvmAddress.nullable(),
  rewardsOptIn: z.boolean(),
});
export type AuthUser = z.infer<typeof AuthUser>;

/** POST /v1/wallet/link — associate a connected EVM wallet with the signed-in user. */
export const WalletLinkRequest = z.object({ walletAddress: EvmAddress });
export type WalletLinkRequest = z.infer<typeof WalletLinkRequest>;

/** PATCH /v1/rewards/opt-in — turn reward payouts on or off for the signed-in user. */
export const OptInRequest = z.object({ optIn: z.boolean() });
export type OptInRequest = z.infer<typeof OptInRequest>;

/**
 * POST /v1/rewards/accrue — called by the trading service (service key) whenever a
 * creator's pick is tailed or copied. The reward is a fraction of the tail amount.
 */
export const RewardAccrueRequest = z.object({
  creatorHandle: z.string().min(1),
  tailId: z.string().uuid(),
  mode: z.enum(["paper", "live"]),
  /** USDC the follower put on the pick. */
  amountUsdc: z.number().positive(),
});
export type RewardAccrueRequest = z.infer<typeof RewardAccrueRequest>;

export const RewardAccrueResponse = z.object({
  /** false when the creator has not opted in or has no linked wallet, or the reward was already paid. */
  credited: z.boolean(),
  amountUsdc: z.number().nullable(),
  txHash: z.string().nullable(),
  reason: z.string(),
});
export type RewardAccrueResponse = z.infer<typeof RewardAccrueResponse>;

/** One earnings_ledger row as returned by the API. */
export const EarningRow = z.object({
  id: z.string().uuid(),
  amountUsdc: z.number(),
  reason: z.string(),
  txHash: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type EarningRow = z.infer<typeof EarningRow>;

/** GET /v1/users/:id/earnings */
export const EarningsSummary = z.object({
  userId: z.string().uuid(),
  handle: z.string(),
  walletAddress: EvmAddress.nullable(),
  optedIn: z.boolean(),
  totalEarnedUsdc: z.number(),
  redeemedUsdc: z.number(),
  availableUsdc: z.number(),
  rows: z.array(EarningRow),
});
export type EarningsSummary = z.infer<typeof EarningsSummary>;

/** POST /v1/redeem — withdraw accrued USDC to the user's connected wallet. */
export const RedeemRequest = z.object({
  /** Omit to redeem the full available balance. */
  amountUsdc: z.number().positive().optional(),
});
export type RedeemRequest = z.infer<typeof RedeemRequest>;

export const RedeemResponse = z.object({
  amountUsdc: z.number(),
  txHash: z.string(),
  availableUsdc: z.number(),
});
export type RedeemResponse = z.infer<typeof RedeemResponse>;
