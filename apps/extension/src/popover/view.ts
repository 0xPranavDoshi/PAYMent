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

export interface ProfileView {
  badge: BadgeView;
  summary: string;
  /** Shown under the summary when the user is still on the New badge. */
  note: string | null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function profileView(profile: UserProfile): ProfileView {
  const badge = badgeView(profile)!;
  const hit = profile.hitRate === null ? "" : ` · ${Math.round(profile.hitRate * 100)}% hit rate`;
  return {
    badge,
    summary: `${plural(profile.nResolved, "resolved pick")}${hit}`,
    note:
      profile.tier === "new"
        ? `A score appears after ${NEW_BADGE_MIN_RESOLVED} resolved picks.`
        : null,
  };
}
