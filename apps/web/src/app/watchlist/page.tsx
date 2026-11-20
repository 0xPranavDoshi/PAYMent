import Page from "@/components/Page";
import Link from "next/link";
import { fetchCopyMode, fetchCopyTrades, fetchWatches } from "@/lib/api";
import { formatSignedPct, formatUsd, shortDate, tone } from "@/lib/format";
import { getFollowerId } from "@/lib/session";
import ScoreRing from "@/components/ScoreRing";
import { CopyButton, WatchButton } from "@/components/TradeButtons";
import SignInPrompt from "@/components/SignInPrompt";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchlist · coPAYMe" };

export default async function WatchlistPage() {
  const followerId = await getFollowerId();
  if (!followerId) return <SignInPrompt title="Your watchlist" body="Sign in to follow traders and see how they do from the moment you start watching." />;

  let watches: Awaited<ReturnType<typeof fetchWatches>> = [];
  let copies: Awaited<ReturnType<typeof fetchCopyTrades>> = [];
  let error: string | null = null;
  const paper = (await fetchCopyMode()) === "paper";
  try {
    [watches, copies] = await Promise.all([fetchWatches(followerId), fetchCopyTrades(followerId)]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load your watchlist.";
  }

  const staked = watches.reduce((s, w) => s + w.stakedUsdc, 0);
  const projected = watches.reduce((s, w) => s + (w.projectedPnlUsdc ?? 0), 0);
  const pct = staked > 0 ? (projected / staked) * 100 : null;
  const copyBy = new Map(copies.map((c) => [c.traderHandle.toLowerCase(), c]));

  return (
    <Page live>
      <h1 className="ptitle">Watchlist</h1>
      <p className="psub">
        How each trader has done since you started watching, as if you had put $1 on every pick.
      </p>

      {error ? (
        <p className="down" style={{ marginTop: 20 }}>{error}</p>
      ) : watches.length === 0 ? (
        <div className="card empty-card">
          <h3>Nothing here yet</h3>
          <p className="muted">Watch a trader from the leaderboard or their profile, and they will show up here.</p>
          <Link href="/leaderboard" className="btn primary" style={{ marginTop: 14 }}>Browse the leaderboard</Link>
        </div>
      ) : (
        <>
          <div className="stats three">
            <div><b>{watches.length}</b><span>Watching</span></div>
            <div>
              <b className={tone(projected)}>{formatUsd(projected)}</b>
              <span>Projected P&amp;L</span>
            </div>
            <div>
              <b className={tone(pct)}>{pct === null ? "–" : formatSignedPct(pct)}</b>
              <span>Return on {formatUsd(staked, false)} staked</span>
            </div>
          </div>

          <div className="board">
            {watches.map((w) => {
              const copy = copyBy.get(w.traderHandle.toLowerCase()) ?? null;
              const delta = w.scoreDelta;
              return (
                <div className="wrow" key={w.traderHandle}>
                  <ScoreRing score={w.scoreNow} size={52} />
                  <div className="wmain">
                    <Link href={`/traders/${encodeURIComponent(w.traderHandle)}`} className="who">@{w.traderHandle}</Link>
                    <div className="wsub">
                      Since {shortDate(w.watchedAt)}
                      {w.scoreAtWatch !== null && w.scoreNow !== null && (
                        <> · score {w.scoreAtWatch} → {w.scoreNow}
                          {delta !== null && delta !== 0 && <span className={delta > 0 ? "up" : "down"}> ({delta > 0 ? "+" : "−"}{Math.abs(delta)})</span>}
                        </>
                      )}
                      {" "}· {w.nPicks - w.activePicks} settled, {w.activePicks} open
                    </div>
                  </div>
                  <div className="wpnl">
                    <b className={tone(w.projectedPnlUsdc)}>{w.pnlPct === null ? "–" : formatSignedPct(w.pnlPct)}</b>
                    <small className={tone(w.projectedPnlUsdc)}>{w.projectedPnlUsdc === null ? (w.nPicks === 0 ? "No picks yet" : "Not priced yet") : formatUsd(w.projectedPnlUsdc)}</small>
                  </div>
                  <div className="wact">
                    <CopyButton handle={w.traderHandle} copy={copy} signedIn paper={paper} />
                    <WatchButton handle={w.traderHandle} watching signedIn />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Page>
  );
}
