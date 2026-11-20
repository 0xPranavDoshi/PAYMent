import Page from "@/components/Page";
import { fetchCopyTrades, fetchLeaderboard, fetchScoreHistory, type LeaderboardEntry } from "@/lib/api";
import LeaderboardTable from "@/components/LeaderboardTable";
import type { CopyState } from "@/components/CopyTicket";
import { getFollowerId } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  let entries: LeaderboardEntry[] = [];
  let error: string | null = null;
  try {
    entries = await fetchLeaderboard(100);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load the leaderboard.";
  }

  const viewerId = await getFollowerId();
  const [history, copyTrades] = await Promise.all([
    entries[0] ? fetchScoreHistory(entries[0].handle) : Promise.resolve([]),
    viewerId ? fetchCopyTrades(viewerId).catch(() => []) : Promise.resolve([]),
  ]);
  const copies: Record<string, CopyState> = {};
  for (const c of copyTrades) copies[c.traderHandle.toLowerCase()] = { active: c.active, amountUsdc: c.amountUsdc, since: c.createdAt };

  return (
    <Page>
      <h1 className="pt">Leaderboard</h1>
      <p className="psub">Traders ranked by score: how far their picks beat the market&apos;s odds.</p>
      {error ? (
        <p className="down" style={{ marginTop: 20 }}>{error}</p>
      ) : (
        <LeaderboardTable entries={entries} history={history.map((h) => h.score)} copies={copies} signedIn={viewerId !== null} viewerId={viewerId} />
      )}
    </Page>
  );
}
