import Link from "next/link";
import { fetchCopyTrades, fetchLeaderboard, fetchRecentCalls, type LeaderboardEntry } from "@/lib/api";
import { formatCents, timeAgo } from "@/lib/format";
import type { CopyState } from "@/components/CopyTicket";
import ExtensionPromo from "@/components/ExtensionPromo";
import Page from "@/components/Page";
import PickTicker from "@/components/PickTicker";
import TopTraders from "@/components/TopTraders";
import { getFollowerId } from "@/lib/session";

export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Add the extension", body: "A score badge appears next to every handle that posts picks on X." },
  { title: "Check the record", body: "Tap a badge to see wins, losses, and whether their picks beat the price." },
  { title: "Copy the good ones", body: "Mirror a trader's next picks with paper money, or watch them for free." },
];

export default async function Home() {
  let board: LeaderboardEntry[] = [];
  try {
    board = await fetchLeaderboard(100);
  } catch {
    // The page degrades to the empty state below.
  }
  const viewerId = await getFollowerId();
  const [recent, copyTrades] = await Promise.all([
    fetchRecentCalls(8).catch(() => []),
    viewerId ? fetchCopyTrades(viewerId).catch(() => []) : Promise.resolve([]),
  ]);
  const copies: Record<string, CopyState> = {};
  for (const c of copyTrades) copies[c.traderHandle.toLowerCase()] = { active: c.active, amountUsdc: c.amountUsdc, since: c.createdAt };

  return (
    <>
      <Page>
        <section className="hm-hero">
          <div>
            <h1>Every pick on X, <mark>scored</mark> against the market.</h1>
            <p>
              coPAYMe logs every pick at the price the market charged when it was posted. Then it grades the pick when the game
              settles. See who actually beats the odds, right on their tweets.
            </p>
            <ExtensionPromo />
          </div>
          <div className="hm-shot" aria-hidden="true">
            <div className="tweet">
              <div className="hd">
                <span className="ta">DS</span>
                <b>Demo Sharp</b>
                <span className="at">@demo_sharp</span>
                <span className="bd"><i />82<em>▲16</em></span>
              </div>
              <p>Chiefs −2.5 tonight. Buffalo&apos;s run defense has been a sieve since Week 6.</p>
            </div>
            <div className="pop">
              <div className="r1">
                <div><b>@demo_sharp</b><small>40 resolved · top 5%</small></div>
                <div className="s">82</div>
              </div>
              <div className="kv">
                <div><span>RECORD</span><b><span className="g">24</span>–<span className="rd">16</span></b></div>
                <div><span>HIT RATE</span><b>60%</b></div>
                <div><span>EDGE</span><b className="g">+11¢</b></div>
              </div>
              <div className="ac"><span className="b">Watch</span><span className="b or">Copy trade</span></div>
            </div>
            <div className="hm-sticker">+11¢ per pick<small>beats the market</small></div>
          </div>
        </section>
      </Page>

      <PickTicker calls={recent} />

      <Page>
        <div className="hm-steps">
          {STEPS.map((s, i) => (
            <div className="card hm-step" key={s.title}>
              <div className="n">{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>

        {board.length === 0 ? (
          <div className="card" style={{ marginTop: 44, background: "var(--surface)" }}>The leaderboard is not available right now.</div>
        ) : (
          <div className="hm-two">
            <div>
              <div className="sech" style={{ marginTop: 0 }}>
                <h2 className="h2">Top traders</h2>
                <Link href="/leaderboard" className="btn sm">Full leaderboard →</Link>
              </div>
              <TopTraders entries={board.slice(0, 3)} copies={copies} signedIn={viewerId !== null} viewerId={viewerId} />
            </div>
            <div>
              <div className="sech" style={{ marginTop: 0 }}>
                <h2 className="h2">Latest picks</h2>
              </div>
              <div className="card hm-rows hm-latest">
                {recent.length === 0 && <div className="r"><span className="muted">No picks yet.</span></div>}
                {recent.slice(0, 3).map((c) => (
                  <Link key={c.callId} href={`/traders/${encodeURIComponent(c.handle)}`} className="r">
                    <div>
                      <div className="t">{c.eventName}</div>
                      <div className="s mono">
                        @{c.handle}
                        {c.side ? ` · ${c.side.toUpperCase()}${c.oddsAtCall !== null ? ` ${Math.round(c.oddsAtCall * 100)}¢` : ""}` : ""}
                        {" · "}{timeAgo(c.tweetedAt).replace(" ago", "")}
                      </div>
                    </div>
                    {c.points !== null && c.result ? (
                      <span className={`chip ${c.result === "won" ? "up" : "down"}`}>{formatCents(c.points)}</span>
                    ) : (
                      <span className="tag">{c.status === "pending" ? "PENDING" : c.status.toUpperCase()}</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}
      </Page>
    </>
  );
}
