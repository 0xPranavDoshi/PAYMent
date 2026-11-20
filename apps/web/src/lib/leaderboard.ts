import type { LeaderboardEntry } from "./api";

export type FilterId = "all" | "beating" | "rising" | "new";

export const FILTERS: { id: FilterId; label: string; test: (e: LeaderboardEntry) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "beating", label: "Beating market", test: (e) => e.tier === "scored" && e.skill > 0 },
  { id: "rising", label: "Rising", test: (e) => (e.change14d ?? 0) >= 2 },
  { id: "new", label: "New", test: (e) => e.tier === "new" },
];

/** Podium layout: #2 left, #1 centre, #3 right. */
export function podiumOrder<T>(top: T[]): T[] {
  if (top.length >= 3) return [top[1]!, top[0]!, top[2]!];
  if (top.length === 2) return [top[1]!, top[0]!];
  return top.slice();
}

export function rankOf(board: LeaderboardEntry[], handle: string): { rank: number; total: number } | null {
  const i = board.findIndex((e) => e.handle.toLowerCase() === handle.toLowerCase());
  return i < 0 ? null : { rank: i + 1, total: board.length };
}
