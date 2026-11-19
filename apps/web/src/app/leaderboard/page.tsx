import { fetchLeaderboard, type LeaderboardEntry } from "@/lib/api";
import LeaderboardTable from "@/components/LeaderboardTable";

export default async function LeaderboardPage() {
  let entries: LeaderboardEntry[] = [];
  let error: string | null = null;
  try {
    entries = await fetchLeaderboard(100);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load leaderboard.";
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Leaderboard</h1>
      <p style={{ color: "#9a9a9a", marginTop: -8 }}>
        Top traders by score.
      </p>
      {error ? (
        <p style={{ color: "#e05a5a" }}>{error}</p>
      ) : (
        <LeaderboardTable entries={entries} />
      )}
    </div>
  );
}
