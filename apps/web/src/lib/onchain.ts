import type { AuthUser, EarningsSummary, RedeemResponse } from "@copayme/shared";

// Server-to-server client for the @copayme/onchain service. Only the web server holds
// the service key; the browser never calls the on-chain service directly.

const BASE = process.env.ONCHAIN_URL ?? "http://localhost:8790";

function serviceKey(): string {
  const k = process.env.ONCHAIN_SERVICE_KEY;
  if (!k) throw new Error("ONCHAIN_SERVICE_KEY is not set (apps/web/.env.local)");
  return k;
}

async function call<T>(path: string, init: RequestInit = {}, userId?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-service-key": serviceKey(),
      ...(userId ? { "x-user-id": userId } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const ocUpsertXUser = (xUserId: string, handle: string) =>
  call<AuthUser>("/v1/auth/x/upsert", { method: "POST", body: JSON.stringify({ xUserId, handle }) });

export const ocGetUser = (userId: string) => call<AuthUser>(`/v1/users/${userId}`);

export const ocGetEarnings = (userId: string) => call<EarningsSummary>(`/v1/users/${userId}/earnings`);

export const ocLinkWallet = (userId: string, walletAddress: string) =>
  call<AuthUser>("/v1/wallet/link", { method: "POST", body: JSON.stringify({ walletAddress }) }, userId);

export const ocSetOptIn = (userId: string, optIn: boolean) =>
  call<AuthUser>("/v1/rewards/opt-in", { method: "PATCH", body: JSON.stringify({ optIn }) }, userId);

export const ocRedeem = (userId: string, amountUsdc?: number) =>
  call<RedeemResponse>("/v1/redeem", { method: "POST", body: JSON.stringify(amountUsdc ? { amountUsdc } : {}) }, userId);

// ── Daily revenue share (admin) ──────────────────────────────────────────────

export interface PayoutLine {
  creatorId: string;
  creatorHandle: string;
  tails: number;
  followerProfitUsdc: number;
  feeUsdc: number;
  credited: boolean;
}
export interface PayoutPreview {
  day: string;
  alreadyRanToday: boolean;
  feeRate: number;
  tails: number;
  followerProfitUsdc: number;
  feeTotalUsdc: number;
  feeCreditedUsdc: number;
  feeRetainedUsdc: number;
  lines: PayoutLine[];
}
export interface PayoutRun {
  id: string;
  day: string;
  runBy: string;
  tails: number;
  followerProfitUsdc: number;
  feeTotalUsdc: number;
  feeCreditedUsdc: number;
  feeRetainedUsdc: number;
  createdAt: string;
}

export const ocPayoutPreview = () => call<PayoutPreview>("/v1/payouts/preview", { method: "POST" });
export const ocPayoutRun = (runBy: string) =>
  call<PayoutPreview & { ran: boolean; reason?: string; runId?: string }>("/v1/payouts/run", {
    method: "POST",
    body: JSON.stringify({ runBy }),
  });
export const ocPayoutRuns = () => call<PayoutRun[]>("/v1/payouts/runs");
export const ocTreasury = () => call<{ provider: string; balanceUsdc: number | null }>("/v1/treasury");
