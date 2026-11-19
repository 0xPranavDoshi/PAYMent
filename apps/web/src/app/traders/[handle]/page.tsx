import Page from "@/components/Page";
import { notFound } from "next/navigation";
import { fetchCopyMode, fetchCopyTrades, fetchTraderCalls, fetchTraderProfile, fetchWatches } from "@/lib/api";
import { getFollowerId } from "@/lib/session";
import { CopyButton, WatchButton } from "@/components/TradeButtons";
import { formatCents, formatChange, formatPct, timeAgo } from "@/lib/format";
import ScoreRing from "@/components/ScoreRing";

export const dynamic = "force-dynamic";

export default async function TraderPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await fetchTraderProfile(handle);
  if (!profile) notFound();
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
        <h2>Picks</h2>
        <p className="sub">Price is what the market charged for the pick when it was tweeted. Results are cents per $1 contract.</p>
        <div className="board">
          {calls.length === 0 ? (
            <div className="empty">No picks recorded yet.</div>
          ) : (
            calls.map((c) => {
              const outcome = c.status === "pending" ? "Pending" : c.status === "void" ? "Void" : c.status === "rejected" ? "Rejected" : c.result === "won" ? "Won" : c.result === "lost" ? "Lost" : "Scored";
              const tone = c.points === null ? "muted" : c.result === "won" ? "w" : c.result === "lost" ? "l" : "muted";
              return (
                <div className="pick" key={c.callId}>
                  <div className="top">
                    <span className="event">{c.eventName}</span>
                    <span className={`res ${tone}`}>{c.points === null ? outcome : formatCents(c.points)}</span>
                  </div>
                  <div className="sub">
                    {c.pickLabel}
                    {c.side ? ` · ${c.side.toUpperCase()}` : ""} · {c.oddsAtCall === null ? "unpriced" : `${Math.round(c.oddsAtCall * 100)}¢`}
                    {c.points !== null ? ` · ${outcome}` : ""}
                  </div>
                  <div className="tw">{c.tweetText}</div>
                  <div className="foot">
                    <span>{timeAgo(c.tweetedAt)}</span>
                    <a href={`https://x.com/i/status/${encodeURIComponent(c.tweetId)}`} target="_blank" rel="noopener noreferrer">
                      Open on X ↗
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </Page>
  );
}
