import type { CallEntry, UserProfile } from "@copayme/shared";
import { describe, expect, it } from "vitest";
import { callRowView, formatPoints, profileView } from "./view.js";

const call = (over: Partial<CallEntry> = {}): CallEntry => ({
  callId: "11111111-1111-4111-8111-111111111111",
  tweetId: "1001",
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

describe("profileView", () => {
  const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
    handle: "tipster",
    score: 72,
    change14d: 8,
    tier: "scored",
    nResolved: 42,
    hitRate: 0.69,
    nWins: 29,
    skill: 0.1,
    lastCallAt: null,
    updatedAt: "2026-11-19T12:00:00.000Z",
    latestSnapshot: null,
    ...over,
  });

  it("summarises a scored user", () => {
    const view = profileView(profile());
    expect(view.badge).toMatchObject({ text: "72", arrow: { direction: "up", amount: 8 } });
    expect(view.summary).toBe("42 resolved picks · 69% hit rate");
    expect(view.note).toBeNull();
  });

  it("explains the New badge", () => {
    const view = profileView(profile({ tier: "new", nResolved: 1, hitRate: 1 }));
    expect(view.badge.text).toBe("New");
    expect(view.summary).toBe("1 resolved pick · 100% hit rate");
    expect(view.note).toBe("A score appears after 5 resolved picks.");
  });

  it("leaves out the hit rate when there is none", () => {
    expect(profileView(profile({ hitRate: null })).summary).toBe("42 resolved picks");
  });
});
