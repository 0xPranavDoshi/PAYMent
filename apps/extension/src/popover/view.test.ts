import type { CallEntry, UserProfile } from "@copayme/shared";
import { describe, expect, it } from "vitest";
import { callRowView, formatPoints, profileView, timeAgo } from "./view.js";

const call = (over: Partial<CallEntry> = {}): CallEntry => ({
  callId: "11111111-1111-4111-8111-111111111111",
  tweetId: "1001",
  tweetText: "Taking UConn tonight.",
  tweetedAt: "2026-11-19T12:03:00.000Z",
  eventName: "UConn vs Arizona",
  pickLabel: "UConn",
  side: "yes",
  oddsAtCall: 0.62,
  oddsSource: "snapshot",
  status: "scored",
  result: "won",
  points: 0.38,
  ...over,
});

describe("formatPoints", () => {
  it("signs the number, with a real minus sign, to two places", () => {
    expect(formatPoints(0.38)).toBe("+0.38");
    expect(formatPoints(-0.6)).toBe("−0.60");
    expect(formatPoints(1)).toBe("+1.00");
    expect(formatPoints(0)).toBe("0.00");
    expect(formatPoints(0.004)).toBe("0.00");
    expect(formatPoints(-0.0004)).toBe("0.00");
  });
});

describe("callRowView", () => {
  it("describes a won, priced pick", () => {
    expect(callRowView(call())).toEqual({
      event: "UConn vs Arizona",
      pick: "UConn · YES",
      price: "62¢",
      outcome: { kind: "won", text: "Won" },
      points: "+0.38",
      tweetUrl: "https://x.com/i/status/1001",
    });
  });

  it("shows a lost NO pick with negative points", () => {
    const row = callRowView(call({ side: "no", result: "lost", points: -0.4, oddsAtCall: 0.4 }));
    expect(row).toMatchObject({ pick: "UConn · NO", price: "40¢", points: "−0.40", outcome: { kind: "lost", text: "Lost" } });
  });

  it("shows pending, void and rejected picks with no points", () => {
    expect(callRowView(call({ status: "pending", result: null, points: null })).outcome).toEqual({ kind: "pending", text: "Pending" });
    expect(callRowView(call({ status: "void", result: null, points: null })).outcome).toEqual({ kind: "void", text: "Void" });
    expect(callRowView(call({ status: "rejected", result: null, points: null })).outcome).toEqual({ kind: "void", text: "Rejected" });
  });

  it("marks an unpriced pick as such and gives it no points, but still shows whether it won", () => {
    const row = callRowView(call({ oddsAtCall: null, oddsSource: "none", points: null }));
    expect(row).toMatchObject({ price: "unpriced", points: null, outcome: { kind: "won" } });
  });

  it("drops the side when it was not recorded, and handles a scored call with no known result", () => {
    expect(callRowView(call({ side: null })).pick).toBe("UConn");
    expect(callRowView(call({ result: null })).outcome).toEqual({ kind: "scored", text: "Scored" });
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();
  it("says how long ago, in the largest sensible unit", () => {
    expect(timeAgo(ago(5), now)).toBe("just now");
    expect(timeAgo(ago(60), now)).toBe("1m ago");
    expect(timeAgo(ago(59 * 60), now)).toBe("59m ago");
    expect(timeAgo(ago(3600), now)).toBe("1h ago");
    expect(timeAgo(ago(26 * 3600), now)).toBe("1d ago");
    expect(timeAgo(ago(-30), now)).toBe("just now"); // a clock slightly ahead
  });
});

describe("profileView", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
    handle: "tipster",
    score: 72,
    change14d: 8,
    tier: "scored",
    nResolved: 42,
    hitRate: 0.69,
    nWins: 29,
    skill: 0.108,
    lastCallAt: "2026-11-19T09:00:00.000Z",
    updatedAt: "2026-11-19T12:00:00.000Z",
    latestSnapshot: null,
    ...over,
  });

  it("describes a scored user for the ring, the stats and the change chip", () => {
    expect(profileView(profile(), now)).toMatchObject({
      gauge: 72,
      record: "29–13",
      hitRate: "69%",
      picks: "42",
      edge: "+0.11",
      delta: { direction: "up", text: "▲ 8 in 14 days" },
      lastPick: "Last pick 3h ago",
      note: null,
    });
    expect(profileView(profile({ change14d: -6 }), now).delta).toEqual({ direction: "down", text: "▼ 6 in 14 days" });
  });

  it("explains the New badge and leaves the ring empty and the edge blank", () => {
    const view = profileView(profile({ tier: "new", nResolved: 2, nWins: 1, hitRate: 0.5, skill: 0.3 }), now);
    expect(view).toMatchObject({ gauge: null, record: "1–1", edge: "–", note: "A score appears after 5 resolved picks." });
    expect(view.badge.text).toBe("New");
  });

  it("shows no chip for a small or unknown change, and dashes for what is missing", () => {
    expect(profileView(profile({ change14d: 1 }), now).delta).toBeNull();
    expect(profileView(profile({ change14d: null }), now).delta).toBeNull();
    const bare = profileView(profile({ hitRate: null, lastCallAt: null }), now);
    expect(bare.hitRate).toBe("–");
    expect(bare.lastPick).toBeNull();
  });
});
