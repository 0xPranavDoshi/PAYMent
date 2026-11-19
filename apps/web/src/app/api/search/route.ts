import { NextResponse } from "next/server";
import { fetchLeaderboard } from "@/lib/api";

/** Handles containing the query, best matches first (starts-with before contains). */
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().replace(/^@/, "").toLowerCase();
  if (q.length === 0) return NextResponse.json([]);
  try {
    const board = await fetchLeaderboard(100);
    const rank = (h: string) => (h.toLowerCase().startsWith(q) ? 0 : 1);
    const hits = board
      .filter((e) => e.handle.toLowerCase().includes(q))
      .sort((a, b) => rank(a.handle) - rank(b.handle) || b.score - a.score)
      .slice(0, 6)
      .map((e) => ({ handle: e.handle, score: e.tier === "new" ? null : e.score }));
    return NextResponse.json(hits);
  } catch {
    return NextResponse.json([]);
  }
}
