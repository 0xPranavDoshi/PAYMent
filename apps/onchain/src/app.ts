import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import {
  EarningsSummary,
  OptInRequest,
  RedeemRequest,
  RedeemResponse,
  RewardAccrueRequest,
  RewardAccrueResponse,
  WalletLinkRequest,
  XUpsertRequest,
  type AuthUser,
} from "@copayme/shared";
import { rewardAmount } from "./reward.js";
import { normHandle, type OnchainUser, type OnchainStore } from "./store.js";
import type { PaymentProvider } from "./payments.js";

export interface AppDeps {
  store: OnchainStore;
  payments: PaymentProvider;
  /** Shared secret for service-only routes (x-service-key). */
  serviceKey: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toAuthUser(u: OnchainUser): AuthUser {
  return {
    userId: u.id,
    handle: u.handle,
    walletAddress: u.walletAddress,
    rewardsOptIn: u.rewardsOptIn,
  };
}

export function createApp({ store, payments, serviceKey }: AppDeps) {
  const app = new Hono<{ Variables: { user: OnchainUser } }>();

  // Browser (apps/web) calls this service cross-origin. Reflect the request origin
  // (fine for the hackathon; tighten to an allowlist for production).
  app.use(
    "*",
    cors({
      origin: (origin) => origin ?? "*",
      allowHeaders: ["Content-Type", "x-user-id", "x-service-key"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  const requireServiceKey = async (c: Context, next: () => Promise<void>) => {
    if (c.req.header("x-service-key") !== serviceKey) return c.json({ error: "unauthorized" }, 401);
    return next();
  };

  /**
   * Resolves the acting user for user-scoped routes. The browser never calls this
   * service directly; the website's backend does, server-to-server, presenting the
   * service key plus the authenticated user's id (x-user-id). We therefore require a
   * valid service key — a raw x-user-id from an untrusted client is not accepted.
   */
  const requireUser = async (c: Context<{ Variables: { user: OnchainUser } }>, next: () => Promise<void>) => {
    if (c.req.header("x-service-key") !== serviceKey) return c.json({ error: "unauthorized" }, 401);
    const id = c.req.header("x-user-id");
    if (!id || !UUID_RE.test(id)) return c.json({ error: "x-user-id header with a valid UUID is required" }, 400);
    const user = await store.findUserById(id);
    if (!user) return c.json({ error: "unknown user" }, 404);
    c.set("user", user);
    return next();
  };

  app.get("/health", (c) => c.json({ ok: true, paymentProvider: payments.kind }));

  // ── Auth / identity ─────────────────────────────────────────────────────────

  /** Upsert the users row for an X account after X login. Called by the web backend. */
  app.post("/v1/auth/x/upsert", requireServiceKey, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = XUpsertRequest.safeParse(body);
    if (!parsed.success) return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    const user = await store.upsertXUser(parsed.data);
    return c.json(toAuthUser(user), 201);
  });

  // ── Wallet + opt-in (signed-in user) ─────────────────────────────────────────

  app.post("/v1/wallet/link", requireUser, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = WalletLinkRequest.safeParse(body);
    if (!parsed.success) return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    const user = c.get("user");
    await store.setWalletAddress(user.id, parsed.data.walletAddress);
    return c.json(toAuthUser({ ...user, walletAddress: parsed.data.walletAddress }));
  });

  app.patch("/v1/rewards/opt-in", requireUser, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = OptInRequest.safeParse(body);
    if (!parsed.success) return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    const user = c.get("user");
    await store.setOptIn(user.id, parsed.data.optIn);
    return c.json(toAuthUser({ ...user, rewardsOptIn: parsed.data.optIn }));
  });

  // ── Rewards (service-to-service) ─────────────────────────────────────────────

  /**
   * Accrue a reward to a creator because a follower tailed their pick. Called by
   * the trading service when it creates a tail. Idempotent per tail. A single
   * payout failure never throws — it reports credited:false so the caller proceeds.
   */
  app.post("/v1/rewards/accrue", requireServiceKey, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = RewardAccrueRequest.safeParse(body);
    if (!parsed.success) return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    const { creatorHandle, tailId, mode, amountUsdc } = parsed.data;

    const notCredited = (reason: string): RewardAccrueResponse => ({
      credited: false,
      amountUsdc: null,
      txHash: null,
      reason,
    });

    const creator = await store.findUserByHandle(normHandle(creatorHandle));
    if (!creator) return c.json(notCredited("creator_unknown"));
    if (!creator.rewardsOptIn) return c.json(notCredited("creator_not_opted_in"));
    if (!creator.walletAddress) return c.json(notCredited("creator_no_wallet"));

    const sourceRef = `reward:${tailId}`;
    if (await store.ledgerExists(sourceRef)) return c.json(notCredited("already_rewarded"));

    const amount = rewardAmount(amountUsdc);
    const reason = mode === "live" ? "copy_reward" : "tail_reward";
    // Rewards accrue to the ledger only — gas-free and instant. The single real
    // on-chain USDC transfer happens once at redeem (cash-out), so creators never
    // pay gas per micro-reward.
    try {
      await store.addLedgerEntry({ userId: creator.id, amountUsdc: amount, reason, txHash: null, sourceRef });
      const res: RewardAccrueResponse = { credited: true, amountUsdc: amount, txHash: null, reason };
      return c.json(res, 201);
    } catch (err) {
      console.error(`[rewards] accrual failed for ${creator.handle} (${sourceRef}):`, err);
      return c.json(notCredited("accrual_failed"));
    }
  });

  // ── Earnings + redeem (signed-in user) ───────────────────────────────────────

  /** Fetch a user (identity + wallet + opt-in) for the web backend to hydrate its session. */
  app.get("/v1/users/:id", requireServiceKey, async (c) => {
    const id = c.req.param("id");
    if (!id || !UUID_RE.test(id)) return c.json({ error: "invalid user id" }, 400);
    const user = await store.findUserById(id);
    if (!user) return c.json({ error: "not found" }, 404);
    return c.json(toAuthUser(user));
  });

  app.get("/v1/users/:id/earnings", requireServiceKey, async (c) => {
    const id = c.req.param("id");
    if (!id || !UUID_RE.test(id)) return c.json({ error: "invalid user id" }, 400);

    const user = await store.findUserById(id);
    if (!user) return c.json({ error: "not found" }, 404);
    const totals = await store.earningsFor(id);
    const summary: EarningsSummary = {
      userId: user.id,
      handle: user.handle,
      walletAddress: user.walletAddress,
      optedIn: user.rewardsOptIn,
      totalEarnedUsdc: totals.totalEarnedUsdc,
      redeemedUsdc: totals.redeemedUsdc,
      availableUsdc: totals.availableUsdc,
      rows: totals.rows.map((r) => ({
        id: r.id,
        amountUsdc: r.amountUsdc,
        reason: r.reason,
        txHash: r.txHash,
        createdAt: r.createdAt.toISOString(),
      })),
    };
    return c.json(summary);
  });

  app.post("/v1/redeem", requireUser, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = RedeemRequest.safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    const user = c.get("user");
    if (!user.walletAddress) return c.json({ error: "no wallet linked" }, 400);

    const totals = await store.earningsFor(user.id);
    const amount = parsed.data.amountUsdc ?? totals.availableUsdc;
    if (amount <= 0) return c.json({ error: "nothing to redeem" }, 409);
    if (amount > totals.availableUsdc + 1e-9) {
      return c.json({ error: "amount exceeds available balance", availableUsdc: totals.availableUsdc }, 409);
    }

    const { txHash } = await payments.redeemTo(user.walletAddress, amount, `redeem:${user.id}`);
    await store.addLedgerEntry({ userId: user.id, amountUsdc: -amount, reason: "redeem", txHash });
    const res: RedeemResponse = {
      amountUsdc: amount,
      txHash,
      availableUsdc: Math.round((totals.availableUsdc - amount) * 1e6) / 1e6,
    };
    return c.json(res);
  });

  return app;
}
