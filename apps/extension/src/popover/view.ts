import { NEW_BADGE_MIN_RESOLVED, type CallEntry, type UserProfile } from "@copayme/shared";
import { badgeView, type BadgeView } from "../badgeView.js";

export interface CallRowView {
  event: string;
  /** "UConn · YES", or just the contract when the side was not recorded. */
  pick: string;
  /** Price of the pick when it was made, in cents, or "unpriced". */
  price: string;
  outcome: { kind: "won" | "lost" | "scored" | "pending" | "void"; text: string };
  /** "+0.40", "−0.60", or null when the call earned no points. */
  points: string | null;
  tweetUrl: string;
}

/** A signed number with a real minus sign, so + and − line up. */
export function formatPoints(points: number): string {
  const rounded = Math.round(points * 100) / 100;
  if (rounded === 0) return "0.00";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(2)}`;
}

export function callRowView(call: CallEntry): CallRowView {
  const outcome: CallRowView["outcome"] =
    call.status === "pending"
      ? { kind: "pending", text: "Pending" }
      : call.status === "void"
        ? { kind: "void", text: "Void" }
        : call.status === "rejected"
          ? { kind: "void", text: "Rejected" }
          : call.result === "won"
            ? { kind: "won", text: "Won" }
            : call.result === "lost"
              ? { kind: "lost", text: "Lost" }
              : { kind: "scored", text: "Scored" };

  return {
    event: call.eventName,
    pick: call.side ? `${call.pickLabel} · ${call.side.toUpperCase()}` : call.pickLabel,
    price: call.oddsAtCall === null ? "unpriced" : `${Math.round(call.oddsAtCall * 100)}¢`,
    outcome,
    points: call.points === null ? null : formatPoints(call.points),
    tweetUrl: `https://x.com/i/status/${encodeURIComponent(call.tweetId)}`,
  };
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export interface ProfileView {
  badge: BadgeView;
  /** The score for the ring, or null for a user still on the New badge. */
  gauge: number | null;
  /** Wins and losses, "29–13". */
  record: string;
  hitRate: string;
  picks: string;
  /** Average points per pick beyond the market price, shrunk for small samples, "+0.11". */
  edge: string;
  /** The 14-day change as a chip, or null when there is none worth showing. */
  delta: { direction: "up" | "down"; text: string } | null;
  lastPick: string | null;
  /** Shown when the user is still on the New badge. */
  note: string | null;
}

export function profileView(profile: UserProfile, now: Date = new Date()): ProfileView {
  const badge = badgeView(profile)!;
  const isNew = profile.tier === "new";
  return {
    badge,
    gauge: isNew ? null : profile.score,
    record: `${profile.nWins}–${profile.nResolved - profile.nWins}`,
    hitRate: profile.hitRate === null ? "–" : `${Math.round(profile.hitRate * 100)}%`,
    picks: String(profile.nResolved),
    edge: isNew ? "–" : formatPoints(profile.skill),
    delta: badge.arrow
      ? { direction: badge.arrow.direction, text: `${badge.arrow.direction === "up" ? "▲" : "▼"} ${badge.arrow.amount} in 14 days` }
      : null,
    lastPick: profile.lastCallAt ? `Last pick ${timeAgo(profile.lastCallAt, now)}` : null,
    note: isNew ? `A score appears after ${NEW_BADGE_MIN_RESOLVED} resolved picks.` : null,
  };
}
