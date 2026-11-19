import type { UserProfile, TailResponse, WatchItem, CopyTradeConfig, CallEntry, RecentCall } from "@copayme/shared";

export type { WatchItem, CopyTradeConfig };

const API = process.env.API_URL ?? "http://localhost:8787";
const TRADING = process.env.TRADING_URL ?? "http://localhost:8788";

// ── Local types ───────────────────────────────────────────────────────────────

/** One row of GET {API}/v1/leaderboard. */
export interface LeaderboardEntry {
  handle: string;
  score: number;
  change14d: number | null;
  nResolved: number;
  hitRate: number | null;
  tier: "new" | "scored";
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

function followerHeaders(followerId: string): HeadersInit {
  return { "X-Follower-Id": followerId };
}

// ── API service (scoring / profiles) ─────────────────────────────────────────

export async function fetchLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
  const res = await fetch(`${API}/v1/leaderboard?limit=${limit}`, { next: { revalidate: 20 } });
  if (!res.ok) throw new Error(`fetchLeaderboard failed: ${res.status}`);
  return (await res.json()) as LeaderboardEntry[];
}

export async function fetchTraderProfile(
  handle: string,
): Promise<UserProfile | null> {
  const res = await fetch(`${API}/v1/users/${encodeURIComponent(handle)}`, { next: { revalidate: 20 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchTraderProfile failed: ${res.status}`);
  return (await res.json()) as UserProfile;
}

/** The latest picks across all traders (GET /v1/calls/recent). */
export async function fetchRecentCalls(limit = 6): Promise<RecentCall[]> {
  const res = await fetch(`${API}/v1/calls/recent?limit=${limit}`, { next: { revalidate: 20 } });
  if (!res.ok) throw new Error(`fetchRecentCalls failed: ${res.status}`);
  return (await res.json()) as RecentCall[];
}

/** A trader's picks, newest first (GET /v1/users/:handle/calls). */
export async function fetchTraderCalls(handle: string, limit = 50): Promise<CallEntry[]> {
  const res = await fetch(`${API}/v1/users/${encodeURIComponent(handle)}/calls?limit=${limit}`, { next: { revalidate: 20 } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`fetchTraderCalls failed: ${res.status}`);
  return (await res.json()) as CallEntry[];
}

// ── Trading service (watches / copy-trades / tails) ──────────────────────────

/** Whether copy trades are simulated ("paper") or place real orders ("live"). Assumes live if unknown. */
export async function fetchCopyMode(): Promise<"paper" | "live"> {
  try {
    const res = await fetch(`${TRADING}/v1/config`, { cache: "no-store" });
    if (!res.ok) return "live";
    const body = (await res.json()) as { copyTradeMode?: string };
    return body.copyTradeMode === "paper" ? "paper" : "live";
  } catch {
    return "live";
  }
}

export async function fetchWatches(followerId: string): Promise<WatchItem[]> {
  const res = await fetch(`${TRADING}/v1/watches`, {
    headers: followerHeaders(followerId),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`fetchWatches failed: ${res.status}`);
  return (await res.json()) as WatchItem[];
}

export async function addWatch(
  followerId: string,
  traderHandle: string,
): Promise<void> {
  const res = await fetch(`${TRADING}/v1/watches`, {
    method: "POST",
    headers: {
      ...followerHeaders(followerId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ traderHandle }),
  });
  if (!res.ok) throw new Error(`addWatch failed: ${res.status}`);
}

export async function removeWatch(
  followerId: string,
  traderHandle: string,
): Promise<void> {
  const res = await fetch(
    `${TRADING}/v1/watches/${encodeURIComponent(traderHandle)}`,
    {
      method: "DELETE",
      headers: followerHeaders(followerId),
    },
  );
  if (!res.ok) throw new Error(`removeWatch failed: ${res.status}`);
}

export async function fetchCopyTrades(
  followerId: string,
): Promise<CopyTradeConfig[]> {
  const res = await fetch(`${TRADING}/v1/copy-trades`, {
    headers: followerHeaders(followerId),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`fetchCopyTrades failed: ${res.status}`);
  return (await res.json()) as CopyTradeConfig[];
}

/** Start (or re-point) copy-trading a trader at the given per-pick USDC size. */
export async function startCopyTrade(
  followerId: string,
  traderHandle: string,
  amountUsdc: number,
): Promise<CopyTradeConfig> {
  const res = await fetch(`${TRADING}/v1/copy-trades`, {
    method: "POST",
    headers: {
      ...followerHeaders(followerId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ traderHandle, amountUsdc }),
  });
  if (!res.ok) throw new Error(`startCopyTrade failed: ${res.status}`);
  return (await res.json()) as CopyTradeConfig;
}

/** Pause copy-trading a trader (picks already copied stay open). */
export async function stopCopyTrade(
  followerId: string,
  traderHandle: string,
): Promise<void> {
  const res = await fetch(
    `${TRADING}/v1/copy-trades/${encodeURIComponent(traderHandle)}`,
    {
      method: "PATCH",
      headers: {
        ...followerHeaders(followerId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ active: false }),
    },
  );
  if (!res.ok) throw new Error(`stopCopyTrade failed: ${res.status}`);
}

export async function fetchTails(
  followerId: string,
  source?: string,
): Promise<TailResponse[]> {
  const qs = source ? `?source=${encodeURIComponent(source)}` : "";
  const res = await fetch(
    `${TRADING}/v1/users/${encodeURIComponent(followerId)}/tails${qs}`,
    {
      headers: followerHeaders(followerId),
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`fetchTails failed: ${res.status}`);
  return (await res.json()) as TailResponse[];
}
