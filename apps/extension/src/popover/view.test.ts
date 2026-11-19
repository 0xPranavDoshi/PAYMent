import type { CallEntry, UserProfile } from "@copayme/shared";
import { describe, expect, it } from "vitest";
import { callRowView, formatAmount, formatCents, formatTweetTime, parseAmount, profileView, timeAgo } from "./view.js";

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

describe("formatCents", () => {
  it("writes points as signed cents per $1 contract, with a real minus sign", () => {
    expect(formatCents(0.38)).toBe("+38¢");
    expect(formatCents(-0.62)).toBe("−62¢");
    expect(formatCents(0)).toBe("0¢");
    expect(formatCents(0.004)).toBe("0¢");
  });
});

describe("callRowView", () => {
  it("describes a won, priced pick", () => {
    expect(callRowView(call())).toEqual({
      event: "UConn vs Arizona",
      pick: "UConn · YES",
      price: "62¢",
      outcome: { kind: "won", text: "Won" },
      points: "+38¢",
      tweetUrl: "https://x.com/i/status/1001",
    });
  });

  it("shows a lost NO pick with negative points", () => {
    const row = callRowView(call({ side: "no", result: "lost", points: -0.4, oddsAtCall: 0.4 }));
    expect(row).toMatchObject({ pick: "UConn · NO", price: "40¢", points: "−40¢", outcome: { kind: "lost", text: "Lost" } });
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
      edge: "+11¢",
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

describe("formatTweetTime", () => {
  it("writes a tweet's time the way X does", () => {
    const { short, full } = formatTweetTime("2026-11-19T19:03:00.000Z");
    expect(short).toBe(new Date("2026-11-19T19:03:00.000Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    expect(full).toMatch(/^\d{1,2}:\d{2} (AM|PM) · [A-Z][a-z]{2} \d{1,2}, 2026$/);
    expect(full).toContain(short);
  });
});

describe("parseAmount", () => {
  it("accepts any positive dollar amount with at most two decimals, with or without $ and commas", () => {
    expect(parseAmount("7")).toBe(7);
    expect(parseAmount("7.5")).toBe(7.5);
    expect(parseAmount("12.50")).toBe(12.5);
    expect(parseAmount("$12.50")).toBe(12.5);
    expect(parseAmount(" 1,000 ")).toBe(1000);
    expect(parseAmount("0.01")).toBe(0.01);
    expect(parseAmount("250")).toBe(250);
  });

  it("rejects everything else", () => {
    for (const bad of ["", " ", "0", "0.00", "-5", "abc", "1.234", "1e3", "5 dollars", "$", "1..5", ".5", "∞"]) {
      expect(parseAmount(bad), bad).toBeNull();
    }
  });
});

describe("formatAmount", () => {
  it("writes whole dollars plainly and anything else to the cent", () => {
    expect(formatAmount(25)).toBe("$25");
    expect(formatAmount(7.5)).toBe("$7.50");
    expect(formatAmount(0.01)).toBe("$0.01");
    expect(formatAmount(1000)).toBe("$1000");
  });
});
