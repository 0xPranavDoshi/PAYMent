import { NEW_BADGE_MIN_RESOLVED, marketUrl, type CallEntry, type UserProfile } from "@copayme/shared";
import { tweetUrl } from "@copayme/shared/tweet-text";
import { badgeView, type BadgeView } from "../badgeView.js";

/**
 * Points as cents per $1 contract, with a real minus sign so + and − line up: 0.38 is "+38¢". A pick
 * bought at 62¢ that wins pays $1, so it made 38¢; one that loses costs the 62¢. That matches the
 * price shown beside it.
 */
export function formatCents(points: number): string {
  const cents = Math.round(points * 100);
  if (cents === 0) return "0¢";
  return `${cents > 0 ? "+" : "−"}${Math.abs(cents)}¢`;
}

export interface CallRowView {
  event: string;
  /** "UConn · YES", or just the contract when the side was not recorded. */
  pick: string;
  /** Price of the pick when it was made, in cents, or "unpriced". */
  price: string;
  outcome: { kind: "won" | "lost" | "scored" | "pending" | "void"; text: string };
  /** "+40¢", "−60¢", or null when the call earned no points. */
  points: string | null;
  tweetUrl: string;
  /** The market on Gemini, where its price and result can be checked; null when the ticker is not known. */
  marketUrl: string | null;
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
    points: call.points === null ? null : formatCents(call.points),
    tweetUrl: tweetUrl(call.tweetId),
    marketUrl: call.marketTicker ? marketUrl(call.marketTicker) : null,
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
  /** Wins and losses, "29–13", and each count on its own so they can be coloured. */
  record: string;
  wins: number;
  losses: number;
  hitRate: string;
  picks: string;
  /** Average cents per $1 contract beyond the market price, shrunk for small samples, "+11¢". */
  edge: string;
  /** Green for a positive edge, red for a negative one, plain when it rounds to zero or there is none. */
  edgeTone: "up" | "down" | "none";
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
    wins: profile.nWins,
    losses: profile.nResolved - profile.nWins,
    hitRate: profile.hitRate === null ? "–" : `${Math.round(profile.hitRate * 100)}%`,
    picks: String(profile.nResolved),
    edge: isNew ? "–" : formatCents(profile.skill),
    edgeTone: isNew || Math.round(profile.skill * 100) === 0 ? "none" : profile.skill > 0 ? "up" : "down",
    delta: badge.arrow
      ? { direction: badge.arrow.direction, text: `${badge.arrow.direction === "up" ? "▲" : "▼"} ${badge.arrow.amount} in 14 days` }
      : null,
    lastPick: profile.lastCallAt ? `Last pick ${timeAgo(profile.lastCallAt, now)}` : null,
    note: isNew ? `A score appears after ${NEW_BADGE_MIN_RESOLVED} resolved picks.` : null,
  };
}

/**
 * An amount a user typed, in dollars: "7", "7.5", "$12.50" and "1,000" are fine. Anything that is not
 * a positive number with at most two decimals (empty, zero, negative, letters, "1e3") is null.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > 0 ? value : null;
}

/** A dollar amount the way a person writes it: "$25", "$7.50". */
export function formatAmount(dollars: number): string {
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
