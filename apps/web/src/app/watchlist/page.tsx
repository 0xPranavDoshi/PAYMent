import Page from "@/components/Page";
import Link from "next/link";
import { fetchCopyTrades, fetchWatches } from "@/lib/api";
import { getFollowerId } from "@/lib/session";
import WatchlistRows from "@/components/WatchlistRows";
import SignInPrompt from "@/components/SignInPrompt";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchlist · coPAYMe" };

export default async function WatchlistPage() {
  const followerId = await getFollowerId();
  if (!followerId) return <SignInPrompt title="Your watchlist" body="Sign in to follow traders and see how they do from the moment you start watching." />;

  let watches: Awaited<ReturnType<typeof fetchWatches>> = [];
  let copies: Awaited<ReturnType<typeof fetchCopyTrades>> = [];
  let error: string | null = null;
  try {
    [watches, copies] = await Promise.all([fetchWatches(followerId), fetchCopyTrades(followerId)]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load your watchlist.";
  }

  const copyBy = new Map(copies.map((c) => [c.traderHandle.toLowerCase(), c]));

  return (
    <Page live>
      <h1 className="pt">Watchlist</h1>
      <p className="psub">
        How each trader has done since you started watching, as if you had put $1 on every pick. These are
        projected results, not trades you made. The trades you actually copy are in your <Link href="/portfolio" className="inline">Portfolio</Link>.
      </p>

      {error ? (
        <p className="down wl-err">{error}</p>
      ) : watches.length === 0 ? (
        <div className="card empty-card">
          <h3>Nothing here yet</h3>
          <p className="muted">Watch a trader from the leaderboard or their profile, and they will show up here.</p>
          <Link href="/leaderboard" className="btn primary" style={{ marginTop: 14 }}>Browse the leaderboard</Link>
        </div>
      ) : (
        <>
          <WatchlistRows
            viewerId={followerId}
            rows={watches.map((w) => {
              const c = copyBy.get(w.traderHandle.toLowerCase());
              return {
                handle: w.traderHandle, watchedAt: w.watchedAt, scoreNow: w.scoreNow, scoreAtWatch: w.scoreAtWatch,
                scoreDelta: w.scoreDelta, nPicks: w.nPicks, activePicks: w.activePicks, pnlPct: w.pnlPct,
                projectedPnlUsdc: w.projectedPnlUsdc,
                copy: c ? { active: c.active, amountUsdc: c.amountUsdc, since: c.createdAt } : null,
              };
            })}
          />
        </>
      )}
    </Page>
  );
}
