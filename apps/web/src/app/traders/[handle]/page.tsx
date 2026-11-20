import Page from "@/components/Page";
import Link from "next/link";
import { fetchCopyMode, fetchCopyTrades, fetchTraderCalls, fetchTraderProfile, fetchWatches } from "@/lib/api";
import { getFollowerId } from "@/lib/session";
import { CopyButton, WatchButton } from "@/components/TradeButtons";
import { formatCents, formatChange, formatPct, timeAgo } from "@/lib/format";
import ScoreRing from "@/components/ScoreRing";
import PickRow from "@/components/PickRow";

export const dynamic = "force-dynamic";

export default async function TraderPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await fetchTraderProfile(handle);
  if (!profile) {
    return (
      <Page>
        <div className="narrow" style={{ marginTop: 40 }}>
          <h1 className="ptitle">We haven&apos;t scored @{handle.replace(/^@/, "")} yet</h1>
          <p className="muted" style={{ marginTop: 10 }}>
            A trader shows up here once they tweet a pick on a market we track. Check the spelling, or find someone from the board.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <Link href="/leaderboard" className="btn primary">Browse the leaderboard</Link>
            <Link href="/" className="btn">Back home</Link>
          </div>
        </div>
      </Page>
    );
  }
  const calls = await fetchTraderCalls(profile.handle).catch(() => []);

  const followerId = await getFollowerId();
  const key = profile.handle.toLowerCase();
  const [watches, copies, mode] = followerId
    ? await Promise.all([fetchWatches(followerId).catch(() => []), fetchCopyTrades(followerId).catch(() => []), fetchCopyMode()])
    : [[], [], "paper" as const];
  const watching = watches.some((w) => w.traderHandle.toLowerCase() === key);
  const copy = copies.find((c) => c.traderHandle.toLowerCase() === key) ?? null;

  const isNew = profile.tier === "new";
  const change = formatChange(profile.change14d);
  const losses = profile.nResolved - profile.nWins;
  const edgeCents = Math.round(profile.skill * 100);

  return (
    <Page>
      <div className="thead">
        <ScoreRing score={isNew ? null : profile.score} size={96} />
        <div>
          <h1>@{profile.handle}</h1>
          <div className="meta">
            {change && <span className={`chip ${change.direction}`}>{change.text} in 14 days</span>}
            {profile.lastCallAt && <span>Last pick {timeAgo(profile.lastCallAt)}</span>}
            <a href={`https://x.com/${encodeURIComponent(profile.handle)}`} target="_blank" rel="noopener noreferrer">
              View on X ↗
            </a>
          </div>
          <div className="actions">
            <WatchButton handle={profile.handle} watching={watching} signedIn={followerId !== null} />
            <CopyButton handle={profile.handle} copy={copy} signedIn={followerId !== null} paper={mode === "paper"} />
          </div>
        </div>
      </div>

      {isNew && (
        <p className="callout muted">A score appears after 5 resolved picks. Until then this trader shows as New.</p>
      )}

      <div className="stats">
        <div>
          <b><span className="w">{profile.nWins}</span>–<span className="l">{losses}</span></b>
          <span>Record</span>
        </div>
        <div>
          <b>{formatPct(profile.hitRate)}</b>
          <span>Hit rate</span>
        </div>
        <div>
          <b>{profile.nResolved}</b>
          <span>Resolved picks</span>
        </div>
        <div>
          <b className={isNew || edgeCents === 0 ? undefined : edgeCents > 0 ? "w" : "l"}>{isNew ? "–" : formatCents(profile.skill)}</b>
          <span>Edge</span>
        </div>
      </div>

      <section className="section">
        <h2 className="sect">Picks</h2>
        <p className="sub">Price is what the market charged for the pick when it was tweeted. Results are cents per $1 contract.</p>
        <div className="board">
          {calls.length === 0 ? (
            <div className="empty">No picks recorded yet.</div>
          ) : (
            calls.map((c) => {
              const outcome = c.status === "pending" ? "Pending" : c.status === "void" ? "Void" : c.status === "rejected" ? "Rejected" : c.result === "won" ? "Won" : c.result === "lost" ? "Lost" : "Scored";
              const tone = c.points === null ? "muted" : c.result === "won" ? "w" : c.result === "lost" ? "l" : "muted";
              return (
                <PickRow
                  key={c.callId}
                  handle={profile.handle}
                  event={c.eventName}
                  pick={`${c.pickLabel}${c.side ? ` · ${c.side.toUpperCase()}` : ""} · ${c.oddsAtCall === null ? "unpriced" : `${Math.round(c.oddsAtCall * 100)}¢`}`}
                  result={c.points === null ? outcome : formatCents(c.points)}
                  tone={tone}
                  outcome={c.points !== null ? `${outcome} · ${timeAgo(c.tweetedAt)}` : timeAgo(c.tweetedAt)}
                  tweetText={c.tweetText}
                  tweetId={c.tweetId}
                  postedAt={c.tweetedAt}
                />
              );
            })
          )}
        </div>
      </section>
    </Page>
  );
}
