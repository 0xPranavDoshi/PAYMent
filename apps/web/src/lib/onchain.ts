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
