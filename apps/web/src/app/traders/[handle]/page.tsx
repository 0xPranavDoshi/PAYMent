import Page from "@/components/Page";
import { marketUrl } from "@copayme/shared/market";
import Link from "next/link";
import { fetchCopyTrades, fetchLeaderboard, fetchTraderCalls, fetchTraderProfile, fetchWatches } from "@/lib/api";
import { rankOf } from "@/lib/leaderboard";
import { getFollowerId } from "@/lib/session";
import { WatchButton } from "@/components/TradeButtons";
import ProfileHead from "@/components/ProfileHead";
import { formatCents, formatChange, formatPct, shortDate, timeAgo } from "@/lib/format";
import ScoreTile from "@/components/ScoreTile";
import PickRow, { type PickRowProps } from "@/components/PickRow";

export const dynamic = "force-dynamic";

export default async function TraderPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await fetchTraderProfile(handle);
  if (!profile) {
    return (
      <Page live>
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
  const followerId = await getFollowerId();
  const key = profile.handle.toLowerCase();
  const [calls, board, watches, copies] = await Promise.all([
    fetchTraderCalls(profile.handle).catch(() => []),
    fetchLeaderboard().catch(() => null),
    followerId ? fetchWatches(followerId).catch(() => []) : [],
    followerId ? fetchCopyTrades(followerId).catch(() => []) : [],
  ]);
  const rank = board ? rankOf(board, profile.handle) : null;
  const watching = watches.some((w) => w.traderHandle.toLowerCase() === key);
  const copyTrade = copies.find((c) => c.traderHandle.toLowerCase() === key);
  const copy = copyTrade ? { active: copyTrade.active, amountUsdc: copyTrade.amountUsdc, since: copyTrade.createdAt } : null;

  const isNew = profile.tier === "new";
  const change = formatChange(profile.change14d);
  const losses = profile.nResolved - profile.nWins;
  const edgeCents = Math.round(profile.skill * 100);

  return (
    <Page live>
      <ProfileHead
        handle={profile.handle}
        copy={copy}
        viewerId={followerId}
        nPicks={profile.nResolved}
        watch={<WatchButton handle={profile.handle} watching={watching} signedIn={followerId !== null} size="lg" />}
      >
        <ScoreTile score={isNew ? null : profile.score} size="lg" />
        <div className="who">
          <h1>@{profile.handle}</h1>
          <div className="meta">
            {change && <span className={`chip ${change.direction}`}>{change.text} in 14 days</span>}
            {rank && <span className="chip">#{rank.rank} of {rank.total}</span>}
            <span className="m">
              {profile.lastCallAt && <>Last pick {timeAgo(profile.lastCallAt)} · </>}
              <a href={`https://x.com/${encodeURIComponent(profile.handle)}`} target="_blank" rel="noopener noreferrer">
                View on X ↗
              </a>
            </span>
          </div>
        </div>
      </ProfileHead>

      {isNew && <p className="muted" style={{ marginTop: 18 }}>A score appears after 5 resolved picks. Until then this trader shows as New.</p>}

      <div className="card strip" style={{ marginTop: 26 }}>
        <div>
          <span>Record</span>
          <b><span className="up">{profile.nWins}</span>–<span className="down">{losses}</span></b>
        </div>
        <div>
          <span>Hit rate</span>
          <b>{formatPct(profile.hitRate)}</b>
        </div>
        <div>
          <span>Edge per pick</span>
          <b className={isNew || edgeCents === 0 ? undefined : edgeCents > 0 ? "up" : "down"}>{isNew ? "–" : formatCents(profile.skill)}</b>
        </div>
        <div>
          <span>Resolved</span>
          <b>{profile.nResolved}</b>
        </div>
      </div>

      <div className="sech">
        <h2 className="h2">Picks</h2>
        <span className="mono" style={{ fontSize: 13, color: "var(--ink-2)" }}>Price when posted · result per $1</span>
      </div>
      <div className="card picks" style={{ background: "var(--surface)", padding: 0 }}>
        {calls.length === 0 ? (
          <div className="pk-empty">No picks recorded yet.</div>
        ) : (
          calls.map((c) => {
            const priced = c.oddsAtCall === null ? null : Math.round(c.oddsAtCall * 100);
            const side = c.side ? c.side.toUpperCase() : "";
            const price = [side, priced === null ? (side ? "" : "UNPRICED") : `${priced}¢`].filter(Boolean).join(" ");
            const result: PickRowProps["result"] =
              c.status === "pending" ? { kind: "tag", text: "PENDING" }
              : c.status === "void" ? { kind: "tag", text: "VOID" }
              : c.status === "rejected" ? { kind: "tag", text: "REJECTED" }
              : c.points === null ? { kind: "tag", text: "SCORED" }
              : { kind: "chip", text: `${c.result === "won" ? "WON" : c.result === "lost" ? "LOST" : "SCORED"} ${formatCents(c.points)}`, tone: c.result === "won" ? "up" : c.result === "lost" ? "down" : "" };
            return (
              <PickRow
                key={c.callId}
                handle={profile.handle}
                date={shortDate(c.tweetedAt).toUpperCase()}
                pick={c.pickLabel}
                event={c.eventName}
                price={price}
                result={result}
                tweetText={c.tweetText}
                tweetId={c.tweetId}
                marketUrl={c.marketTicker ? marketUrl(c.marketTicker) : undefined}
                postedAt={c.tweetedAt}
              />
            );
          })
        )}
      </div>
    </Page>
  );
}
