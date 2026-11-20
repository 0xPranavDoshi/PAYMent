import type { CallEntry, UserProfile } from "@copayme/shared";
import { describe, expect, it } from "vitest";
import { callRowView, formatAmount, formatCents, formatUsd, profileView, recentPicks } from "./view.js";

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
      marketUrl: null, // this fixture has no market ticker
    });
  });

  it("links to the pick's market on Gemini when the ticker is known", () => {
    expect(callRowView(call({ marketTicker: "NCAAM-2611200300-ETAM-CAL-S" })).marketUrl).toBe(
      "https://www.gemini.com/predictions/NCAAM-2611200300-ETAM-CAL-S",
    );
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

describe("recentPicks", () => {
  it("takes the newest picks first, pending ones included, void and rejected ones skipped", () => {
    const at = (callId: string, tweetedAt: string, over: Partial<CallEntry> = {}) => call({ callId, tweetedAt, ...over });
    const picks = [
      at("a", "2026-11-17T00:00:00.000Z"),
      at("b", "2026-11-19T00:00:00.000Z", { status: "pending", result: null, points: null }),
      at("c", "2026-11-20T00:00:00.000Z", { status: "void", result: null, points: null }),
      at("d", "2026-11-21T00:00:00.000Z", { status: "rejected", result: null, points: null }),
      at("e", "2026-11-18T00:00:00.000Z", { result: "lost", points: -0.6 }),
    ];
    expect(recentPicks(picks, 2).map((c) => c.callId)).toEqual(["b", "e"]);
    expect(recentPicks(picks, 5).map((c) => c.callId)).toEqual(["b", "e", "a"]);
    expect(recentPicks([], 2)).toEqual([]);
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
    skill: 0.108,
    lastCallAt: "2026-11-19T09:00:00.000Z",
    updatedAt: "2026-11-19T12:00:00.000Z",
    latestSnapshot: null,
    ...over,
  });

  it("describes a scored user for the ring, the stats and the change chip", () => {
    expect(profileView(profile())).toMatchObject({
      gauge: 72,
      record: "29–13",
      wins: 29,
      losses: 13,
      edgeTone: "up",
      hitRate: "69%",
      picks: "42",
      edge: "+11¢",
      delta: { direction: "up", text: "▲ 8 in 14 days" },
      note: null,
    });
    expect(profileView(profile({ change14d: -6 })).delta).toEqual({ direction: "down", text: "▼ 6 in 14 days" });
  });

  it("explains the New badge and leaves the ring empty and the edge blank", () => {
    const view = profileView(profile({ tier: "new", nResolved: 2, nWins: 1, hitRate: 0.5, skill: 0.3 }));
    expect(view).toMatchObject({ gauge: null, record: "1–1", edge: "–", edgeTone: "none", note: "A score appears after 5 resolved picks." });
    expect(view.badge.text).toBe("New");
  });

  it("shows no chip for a small or unknown change, and dashes for what is missing", () => {
    expect(profileView(profile({ change14d: 1 })).delta).toBeNull();
    expect(profileView(profile({ change14d: null })).delta).toBeNull();
    const bare = profileView(profile({ hitRate: null, lastCallAt: null }));
    expect(bare.hitRate).toBe("–");
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

describe("formatUsd", () => {
  it("writes a signed result to the cent, with a real minus sign", () => {
    expect(formatUsd(9.2307)).toBe("+$9.23");
    expect(formatUsd(-10)).toBe("−$10.00");
    expect(formatUsd(0.001)).toBe("$0.00");
  });
});
