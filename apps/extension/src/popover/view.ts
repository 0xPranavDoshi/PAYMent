import { NEW_BADGE_MIN_RESOLVED, type CallEntry, type UserProfile } from "@copayme/shared";
import { badgeView, type BadgeView } from "../badgeView.js";
import type { WatchInfo } from "../trading.js";

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
}

/**
 * Points as cents per $1 contract, with a real minus sign so + and − line up: 0.38 is "+38¢". A pick
 * bought at 62¢ that wins pays $1, so it made 38¢; one that loses costs the 62¢. That matches the
 * price shown beside it, and unlike a percentage it cannot be mistaken for a return on the amount staked.
 */
export function formatCents(points: number): string {
  const cents = Math.round(points * 100);
  if (cents === 0) return "0¢";
  return `${cents > 0 ? "+" : "−"}${Math.abs(cents)}¢`;
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
  /** Average cents per $1 contract beyond the market price, shrunk for small samples, "+11¢". */
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
    edge: isNew ? "–" : formatCents(profile.skill),
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

/** Dollars, signed, with a real minus sign: "+$0.42", "−$1.10", "$0.00". */
export function formatUsd(dollars: number): string {
  const cents = Math.round(dollars * 100);
  if (cents === 0) return "$0.00";
  return `${cents > 0 ? "+" : "−"}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** A signed percentage to one decimal: "+6.0%", "−12.5%". */
export function formatPct(pct: number): string {
  const tenths = Math.round(pct * 10);
  if (tenths === 0) return "0.0%";
  return `${tenths > 0 ? "+" : "−"}${(Math.abs(tenths) / 10).toFixed(1)}%`;
}

export interface WatchView {
  since: string;
  /** The trader's score when watching started and now, with the change between them. */
  score: { then: string; now: string; delta: { direction: "up" | "down"; text: string } | null };
  /** Paper P&L on the $1 bets that have settled. */
  pnl: { text: string; tone: "up" | "down" | "none" };
  picks: string;
}

/**
 * What a watch has shown since it started. The P&L percentage is the return on the settled $1 paper
 * bets (each watch bet is $1), so +$0.42 over 7 settled bets is +6.0%.
 */
export function watchView(watch: WatchInfo, scoreNow: number | null): WatchView {
  const settled = Math.max(0, watch.picks - watch.openPicks);
  const diff = watch.scoreThen !== null && scoreNow !== null ? scoreNow - watch.scoreThen : null;
  const pnl = watch.paperPnlUsdc;
  return {
    since: new Date(watch.since).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    score: {
      then: watch.scoreThen === null ? "—" : String(watch.scoreThen),
      now: scoreNow === null ? "—" : String(scoreNow),
      delta: diff === null || diff === 0 ? null : { direction: diff > 0 ? "up" : "down", text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)}` },
    },
    pnl:
      pnl === null
        ? { text: "No settled picks yet", tone: "none" }
        : {
            text: settled > 0 ? `${formatUsd(pnl)} · ${formatPct((pnl / settled) * 100)}` : formatUsd(pnl),
            tone: pnl > 0 ? "up" : pnl < 0 ? "down" : "none",
          },
    picks: `${settled} settled · ${watch.openPicks} open`,
  };
}

/** A dollar amount the way a person writes it: "$25", "$7.50". */
export function formatAmount(dollars: number): string {
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
