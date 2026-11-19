import type { UserProfile, TailResponse } from "@copayme/shared";

const API = process.env.API_URL ?? "http://localhost:8787";
const TRADING = process.env.TRADING_URL ?? "http://localhost:8788";

// ── Local types (not yet in @copayme/shared) ─────────────────────────────────

/** One row of GET {API}/v1/leaderboard. */
export interface LeaderboardEntry {
  handle: string;
  score: number;
  change14d: number | null;
  nResolved: number;
  hitRate: number | null;
  tier: "new" | "scored";
}

/** One watched trader on the trading service. */
export interface WatchItem {
  traderHandle: string;
  nPicks: number;
  activePicks: number;
  paperPnlUsdc: number | null;
}

/** A follower's copy-trade configuration. */
export interface CopyTradeConfig {
  id: string;
  traderHandle: string;
  mode: "paper" | "live";
  amountUsdc: number;
  active: boolean;
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

function followerHeaders(followerId: string): HeadersInit {
  return { "X-Follower-Id": followerId };
}

// ── API service (scoring / profiles) ─────────────────────────────────────────

export async function fetchLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
  const res = await fetch(`${API}/v1/leaderboard?limit=${limit}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`fetchLeaderboard failed: ${res.status}`);
  return (await res.json()) as LeaderboardEntry[];
}

export async function fetchTraderProfile(
  handle: string,
): Promise<UserProfile | null> {
  const res = await fetch(`${API}/v1/users/${encodeURIComponent(handle)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchTraderProfile failed: ${res.status}`);
  return (await res.json()) as UserProfile;
}

// ── Trading service (watches / copy-trades / tails) ──────────────────────────

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
