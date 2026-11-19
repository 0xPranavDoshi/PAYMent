import type { CallEntry, UserProfile } from "@copayme/shared";
import { formatCents, formatChange, formatPct, scoreHue } from "@/lib/format";
import Mark from "./Mark";
import ScoreRing from "./ScoreRing";
import { CopyIcon, EyeIcon } from "./Icons";

/**
 * The product itself: a tweet on X with the coPAYMe badge, and the card that opens from it.
 * Built from a real trader's profile and picks, so the landing page shows what the extension shows.
 */
export default function ProductShot({ profile, calls }: { profile: UserProfile; calls: CallEntry[] }) {
  const score = profile.tier === "new" ? null : profile.score;
  const change = formatChange(profile.change14d);
  const withText = calls.find((c) => c.tweetText.trim().length > 0);
  const edge = Math.round(profile.skill * 100);
  const losses = profile.nResolved - profile.nWins;
  const hue = scoreHue(score ?? 50);
  return (
    <div className="ps" aria-label={`The coPAYMe card for @${profile.handle}`}>
      <div className="ps-tweet">
        <div className="th">
          <div className="ps-av">{profile.handle[0]?.toUpperCase()}</div>
          <div>
            <b>@{profile.handle}</b>
            <span className="ps-badge" style={{ ["--h" as string]: hue }}>
              <Mark />
              {score ?? "NEW"}
              {change && <i style={change.direction === "down" ? { color: "#ef5b45" } : undefined}>{change.text}</i>}
            </span>
            <br />
            <small>@{profile.handle} · 3h</small>
          </div>
        </div>
        <p>{withText ? withText.tweetText : "Locking this one in tonight."}</p>
      </div>

      <div className="ps-card">
        <div className="top">
          <ScoreRing score={score} size={72} />
          <div>
            <b>@{profile.handle}</b>
            <span className="muted" style={{ fontSize: 13 }}>{change ? `${change.text} in 14 days` : `${profile.nResolved} resolved picks`}</span>
          </div>
        </div>
        <div className="stats three">
          <div><b><span className="w">{profile.nWins}</span>–<span className="l">{losses}</span></b><span>Record</span></div>
          <div><b>{formatPct(profile.hitRate)}</b><span>Hit rate</span></div>
          <div><b className={edge === 0 ? undefined : edge > 0 ? "w" : "l"}>{formatCents(profile.skill)}</b><span>Edge</span></div>
        </div>
        <div className="ps-actions">
          <span className="btn sm"><EyeIcon /> Watch</span>
          <span className="btn sm primary"><CopyIcon /> Copy trade</span>
        </div>
        {calls.length > 0 && <div className="ps-picks">
          <h4>Recent picks</h4>
          {calls.slice(0, 3).map((c) => {
            const tone = c.points === null ? "muted" : c.result === "won" ? "w" : c.result === "lost" ? "l" : "muted";
            return (
              <div className="ps-pick" key={c.callId}>
                <div>
                  <div className="e">{c.eventName}</div>
                  <div className="s">{c.pickLabel}{c.side ? ` · ${c.side.toUpperCase()}` : ""}{c.oddsAtCall !== null ? ` · ${Math.round(c.oddsAtCall * 100)}¢` : ""}</div>
                </div>
                <span className={`r ${tone}`}>{c.points === null ? (c.status === "pending" ? "Pending" : "–") : formatCents(c.points)}</span>
              </div>
            );
          })}
        </div>}
      </div>
    </div>
  );
}
