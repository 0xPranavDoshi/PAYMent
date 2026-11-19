import Link from "next/link";
import { fetchLeaderboard, fetchTraderCalls, fetchTraderProfile, type LeaderboardEntry } from "@/lib/api";
import { formatChange, scoreHue } from "@/lib/format";
import LeaderboardTable from "@/components/LeaderboardTable";
import Mark from "@/components/Mark";
import ProductShot from "@/components/ProductShot";
import ScoreRing from "@/components/ScoreRing";

export const dynamic = "force-dynamic";

const BADGE_EXAMPLES: { score: number | null; label: string }[] = [
  { score: 82, label: "Beats the market" },
  { score: 50, label: "Breaks even" },
  { score: 31, label: "Trails it" },
  { score: null, label: "Not enough picks" },
];

export default async function Home() {
  let board: LeaderboardEntry[] = [];
  try {
    board = await fetchLeaderboard(100);
  } catch {
    // The page still renders without live numbers.
  }
  const scored = board.filter((e) => e.tier === "scored");
  // Feature the best-scored trader who has real recorded picks, so the card shows what the product shows.
  const candidates = scored.slice(0, 5);
  const found = await Promise.all(candidates.map((e) => fetchTraderCalls(e.handle, 3).catch(() => [])));
  const at = found.findIndex((f) => f.length > 0);
  let lead: LeaderboardEntry | null = at >= 0 ? candidates[at]! : null;
  const leadCalls = at >= 0 ? found[at]! : [];
  lead ??= scored[0] ?? board[0] ?? null;
  const profile = lead ? await fetchTraderProfile(lead.handle).catch(() => null) : null;
  const calls = leadCalls;
  const picksTracked = board.reduce((s, e) => s + e.nResolved, 0);
  const top3 = scored.slice(0, 3);

  return (
    <>
      <div className="container">
        <section className="lhero">
          <div>
            <h1 className="display">
              Every pick, scored against the <em>market</em>.
            </h1>
            <p className="lede">
              Sports X is full of locks of the day. coPAYMe records every pick at the price it was made, so you can see who is
              actually sharp, then watch them or copy their next pick.
            </p>
            <div className="cta">
              <Link href="/leaderboard" className="btn primary lg">Find the sharps</Link>
              <Link href="/how-scoring" className="btn lg">How we score it</Link>
            </div>
            {board.length > 0 && (
              <div className="proof">
                <div><b>{board.length}</b><span>traders scored</span></div>
                <div><b>{picksTracked}</b><span>picks settled</span></div>
                <div><b>Live</b><span>market prices</span></div>
              </div>
            )}
          </div>
          {profile && <ProductShot profile={profile} calls={calls} />}
        </section>

        <section className="block">
          <div className="kicker">The score</div>
          <h2 className="display">Winning a lock isn&apos;t skill. <em>Beating the price</em> is.</h2>
          <p className="sub">
            A pick earns what a $1 contract bought at that moment would have made. Calling an underdog pays; riding a heavy
            favourite barely moves the needle.
          </p>

          <div className="bento">
            <div className="tile w4">
              <div>
                <h3>Scored against the market</h3>
                <p>Same win, very different credit. Points are the outcome minus the price at the time of the tweet.</p>
              </div>
              <div className="viz bars">
                <div className="bar"><span>Win an 85¢ favourite</span><div className="track"><div className="fillbar up" style={{ width: "15%" }} /></div><b className="w">+15¢</b></div>
                <div className="bar"><span>Win a 35¢ underdog</span><div className="track"><div className="fillbar up" style={{ width: "65%" }} /></div><b className="w">+65¢</b></div>
                <div className="bar"><span>Lose an 85¢ favourite</span><div className="track"><div className="fillbar down" style={{ width: "85%" }} /></div><b className="l">−85¢</b></div>
              </div>
            </div>

            <div className="tile w2">
              <div>
                <h3>On every tweet</h3>
                <p>The extension puts the score beside each handle on X.</p>
              </div>
              <div className="viz badges">
                {BADGE_EXAMPLES.map((b) => (
                  <span key={b.label} className="bsample" style={{ ["--h" as string]: scoreHue(b.score ?? 50) }} title={b.label}>
                    <Mark />
                    {b.score ?? "NEW"}
                  </span>
                ))}
              </div>
            </div>

            <div className="tile w3">
              <div>
                <h3>Watch before you commit</h3>
                <p>Add a trader to your watchlist and see how they do from that moment, as if you had put $1 on each pick.</p>
              </div>
              <div className="viz mini">
                {top3.map((e) => {
                  const ch = formatChange(e.change14d);
                  return (
                    <Link key={e.handle} href={`/traders/${encodeURIComponent(e.handle)}`} className="mrow">
                      <ScoreRing score={e.score} size={34} />
                      <b>@{e.handle}</b>
                      <span className={ch ? ch.direction === "up" ? "up" : "down" : "muted"}>{ch ? ch.text : "–"}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="tile w3">
              <div>
                <h3>Then copy the next pick</h3>
                <p>Choose an amount per pick and we mirror their next calls as they tweet them. Simulated for now, so no real money moves.</p>
              </div>
              <div className="viz" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span className="btn is-copying">Copying · $10</span>
                <span className="btn is-watching">Watching</span>
              </div>
            </div>
          </div>
        </section>

        <section className="block">
          <div className="kicker">Leaderboard</div>
          <h2 className="display">Who&apos;s ahead <em>right now</em>.</h2>
          <LeaderboardTable entries={scored.slice(0, 5)} />
          <p style={{ marginTop: 16 }}>
            <Link href="/leaderboard" className="btn sm">See everyone →</Link>
          </p>
        </section>

        <section className="band">
          <h2 className="display">Stop trusting the screenshot. <em>Check the record.</em></h2>
          <Link href="/leaderboard" className="btn primary lg">Open the leaderboard</Link>
        </section>
      </div>
    </>
  );
}
