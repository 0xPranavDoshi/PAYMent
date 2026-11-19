import { NEW_BADGE_MIN_RESOLVED, type CallEntry, type UserProfile } from "@copayme/shared";
import { badgeView, type BadgeView } from "../badgeView.js";

/** A whole-number percentage with a real minus sign, so + and − line up: "+61%", "−100%", "0%". */
export function formatReturn(pct: number): string {
  const whole = Math.round(pct);
  if (whole === 0) return "0%";
  return `${whole > 0 ? "+" : "−"}${Math.abs(whole)}%`;
}

/**
 * What a pick returned on the money put into it, as a percentage. A $1 contract bought at 62¢ that
 * wins pays $1, so it returned 38/62 = +61%; one that loses returns −100%. Null when the pick has no
 * price, or has not settled.
 */
export function returnPct(call: Pick<CallEntry, "oddsAtCall" | "points">): number | null {
  if (call.points === null || call.oddsAtCall === null || call.oddsAtCall <= 0) return null;
  return (call.points / call.oddsAtCall) * 100;
}

export interface CallRowView {
  event: string;
  /** "UConn · YES", or just the contract when the side was not recorded. */
  pick: string;
  /** Price of the pick when it was made, in cents, or "unpriced". */
  price: string;
  outcome: { kind: "won" | "lost" | "scored" | "pending" | "void"; text: string };
  /** The pick's return on what was put in: "+61%", "−100%", or null when it has no price or has not settled. */
  gain: string | null;
  tweetUrl: string;
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

  const pct = returnPct(call);
  return {
    event: call.eventName,
    pick: call.side ? `${call.pickLabel} · ${call.side.toUpperCase()}` : call.pickLabel,
    price: call.oddsAtCall === null ? "unpriced" : `${Math.round(call.oddsAtCall * 100)}¢`,
    outcome,
    gain: pct === null ? null : formatReturn(pct),
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
  /** How far the trader's picks beat the market's odds on average, in percentage points, shrunk for small samples: "+11%". */
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
    edge: isNew ? "–" : formatReturn(profile.skill * 100),
    delta: badge.arrow
      ? { direction: badge.arrow.direction, text: `${badge.arrow.direction === "up" ? "▲" : "▼"} ${badge.arrow.amount} in 14 days` }
      : null,
    lastPick: profile.lastCallAt ? `Last pick ${timeAgo(profile.lastCallAt, now)}` : null,
    note: isNew ? `A score appears after ${NEW_BADGE_MIN_RESOLVED} resolved picks.` : null,
  };
}

/** A tweet's time the way X writes it: "Nov 19" beside the name, "7:03 AM · Nov 19, 2026" under the text. */
export function formatTweetTime(iso: string): { short: string; full: string } {
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const year = date.toLocaleDateString("en-US", { year: "numeric" });
  return { short: day, full: `${time} · ${day}, ${year}` };
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
