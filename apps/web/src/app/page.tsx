import Link from "next/link";
import { fetchLeaderboard, type LeaderboardEntry } from "@/lib/api";
import LeaderboardTable from "@/components/LeaderboardTable";

export const dynamic = "force-dynamic";

export default async function Home() {
  let top: LeaderboardEntry[] = [];
  try {
    top = (await fetchLeaderboard(5)).slice(0, 5);
  } catch {
    // The page still works without the leaderboard preview.
  }
  return (
    <>
      <section className="hero">
        <div className="eyebrow">coPAYMe</div>
        <h1>Find out who is actually sharp.</h1>
        <p className="lede">
          Everyone on X has a lock of the day. We score every pick against the market&apos;s own odds, so you can see who
          really beats it, and follow them.
        </p>
        <div className="cta">
          <Link href="/leaderboard" className="btn primary">See the leaderboard</Link>
          <Link href="/how-scoring" className="btn">How scoring works</Link>
        </div>
      </section>

      <section className="section">
        <h2>How it works</h2>
        <div className="steps">
          <div className="step">
            <div className="n">1</div>
            <h3>Picks are tracked</h3>
            <p>When a trader tweets a pick on a market, we record the market&apos;s price at that moment.</p>
          </div>
          <div className="step">
            <div className="n">2</div>
            <h3>Scored against the market</h3>
            <p>Beating a heavy favourite earns little; calling an underdog earns a lot. Small samples are shrunk toward average.</p>
          </div>
          <div className="step">
            <div className="n">3</div>
            <h3>Watch or copy</h3>
            <p>Add a trader to your watchlist, or copy their next picks. Copy trades are simulated for now.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Top traders</h2>
        <p className="sub">Ranked by score.</p>
        <LeaderboardTable entries={top} />
        <p style={{ marginTop: 14 }}>
          <Link href="/leaderboard" className="muted">View the full leaderboard →</Link>
        </p>
      </section>
    </>
  );
}
