import Link from "next/link";
import { fetchLeaderboard, fetchRecentCalls, fetchTraderCalls, fetchTraderProfile, type LeaderboardEntry } from "@/lib/api";
import { formatCents, formatChange, formatPct } from "@/lib/format";
import ExtensionPromo from "@/components/ExtensionPromo";
import Page from "@/components/Page";
import ScoreRing from "@/components/ScoreRing";
import TraderGrid from "@/components/TraderGrid";

export const dynamic = "force-dynamic";

export default async function Home() {
  let board: LeaderboardEntry[] = [];
  try {
    board = await fetchLeaderboard(100);
  } catch {
    // The page degrades to an empty state below.
  }
  const scored = board.filter((e) => e.tier === "scored");
  // Feature the best-scored trader who has real recorded picks, so the card shows a real record.
  const candidates = scored.slice(0, 5);
  const found = await Promise.all(candidates.map((e) => fetchTraderCalls(e.handle, 5).catch(() => [])));
  const at = found.findIndex((f) => f.length > 0);
  const lead = at >= 0 ? candidates[at]! : (scored[0] ?? board[0] ?? null);
  const calls = at >= 0 ? found[at]! : [];
  const [profile, recent] = await Promise.all([
    lead ? fetchTraderProfile(lead.handle).catch(() => null) : null,
    fetchRecentCalls(4).catch(() => []),
  ]);
  const movers = [...scored].filter((e) => formatChange(e.change14d)).sort((a, b) => Math.abs(b.change14d ?? 0) - Math.abs(a.change14d ?? 0)).slice(0, 5);

  return (
    <Page live>
      <div className="strap">
        <h1>Every pick on X, scored against the market.</h1>
      </div>

      {board.length === 0 ? (
        <div className="empty">The leaderboard is not available right now.</div>
      ) : (
        <>
          <section className="feat">
            {profile && lead && (
              <Link href={`/traders/${encodeURIComponent(profile.handle)}`} className="fcard">
                <div className="eyebrow muted">Featured trader</div>
                <div className="f-head">
                  <ScoreRing score={profile.tier === "new" ? null : profile.score} size={88} />
                  <div>
                    <div className="f-handle">@{profile.handle}</div>
                    <div className="f-meta">
                      <span><b className="w">{profile.nWins}</b>–<b className="l">{profile.nResolved - profile.nWins}</b> record</span>
                      <span><b>{formatPct(profile.hitRate)}</b> hit rate</span>
                      <span><b className={Math.round(profile.skill * 100) >= 0 ? "w" : "l"}>{formatCents(profile.skill)}</b> edge</span>
                    </div>
                  </div>
                </div>
                {calls.length > 0 && (
                  <div className="f-picks">
                    {calls.map((c) => {
                      const tone = c.points === null ? "muted" : c.result === "won" ? "w" : c.result === "lost" ? "l" : "muted";
                      return (
                        <div className="f-pick" key={c.callId}>
                          <div>
                            <div className="e">{c.eventName}</div>
                            <div className="s">{c.pickLabel}{c.side ? ` · ${c.side.toUpperCase()}` : ""}{c.oddsAtCall !== null ? ` · ${Math.round(c.oddsAtCall * 100)}¢` : ""}</div>
                          </div>
                          <span className={`r ${tone}`}>{c.points === null ? "Pending" : formatCents(c.points)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Link>
            )}

            <div className="side-col">
            <aside className="side">
              <h2>Biggest movers <small>14 days</small></h2>
              {movers.length === 0 ? (
                <p className="muted" style={{ fontSize: 14 }}>No big moves yet.</p>
              ) : (
                movers.map((e, i) => {
                  const ch = formatChange(e.change14d)!;
                  return (
                    <Link key={e.handle} href={`/traders/${encodeURIComponent(e.handle)}`} className="mv">
                      <span className="n">{i + 1}</span>
                      <b>@{e.handle}</b>
                      <span className="sc">{e.score}</span>
                      <span className={ch.direction === "up" ? "up" : "down"}>{ch.text}</span>
                    </Link>
                  );
                })
              )}
              <Link href="/leaderboard" className="btn sm" style={{ marginTop: 12, width: "100%" }}>Full leaderboard</Link>
            </aside>

            {recent.length > 0 && (
              <aside className="latest">
                <h2>Latest picks</h2>
                {recent.map((c) => {
                  const tone = c.points === null ? "muted" : c.result === "won" ? "w" : c.result === "lost" ? "l" : "muted";
                  return (
                    <Link key={c.callId} href={`/traders/${encodeURIComponent(c.handle)}`} className="lp">
                      <div>
                        <div className="e">{c.eventName}</div>
                        <div className="who2">@{c.handle}{c.oddsAtCall !== null ? ` · ${Math.round(c.oddsAtCall * 100)}¢` : ""}</div>
                      </div>
                      <span className={`r ${tone}`}>{c.points === null ? "Pending" : formatCents(c.points)}</span>
                    </Link>
                  );
                })}
              </aside>
            )}
            </div>
          </section>

          <section style={{ marginTop: 44 }}>
            <h2 className="sect">Traders</h2>
            <TraderGrid entries={board} />
          </section>

          <ExtensionPromo />
        </>
      )}
    </Page>
  );
}
