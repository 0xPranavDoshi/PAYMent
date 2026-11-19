import Page from "@/components/Page";
import { fetchLeaderboard, type LeaderboardEntry } from "@/lib/api";
import LeaderboardTable from "@/components/LeaderboardTable";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  let entries: LeaderboardEntry[] = [];
  let error: string | null = null;
  try {
    entries = await fetchLeaderboard(100);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load the leaderboard.";
  }
  return (
    <Page>
      <h1 className="ptitle">Leaderboard</h1>
      <p className="psub">Traders ranked by score, which measures how far their picks beat the market&apos;s odds.</p>
      {error ? <p className="down" style={{ marginTop: 20 }}>{error}</p> : <LeaderboardTable entries={entries} />}
    </Page>
  );
}
