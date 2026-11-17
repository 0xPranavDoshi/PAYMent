import { describe, expect, it } from "vitest";
import {
  callPoints,
  changeArrow,
  computeUserScore,
  scoreChange14d,
  scoreFromSkill,
  skillFromPoints,
} from "./scoring.js";

const DAY = 24 * 60 * 60 * 1000;

describe("callPoints (examples from the design doc)", () => {
  it("winning a 0.85 favourite earns +0.15", () => {
    expect(callPoints({ oddsAtCall: 0.85, won: true })).toBeCloseTo(0.15);
  });
  it("winning a 0.35 underdog earns +0.65", () => {
    expect(callPoints({ oddsAtCall: 0.35, won: true })).toBeCloseTo(0.65);
  });
  it("losing a 0.85 favourite costs -0.85", () => {
    expect(callPoints({ oddsAtCall: 0.85, won: false })).toBeCloseTo(-0.85);
  });
  it("rejects odds outside 0 to 1", () => {
    expect(() => callPoints({ oddsAtCall: 1.2, won: true })).toThrow(RangeError);
    expect(() => callPoints({ oddsAtCall: Number.NaN, won: true })).toThrow(RangeError);
  });
});

describe("computeUserScore", () => {
  it("scores an empty record as 50 with a New badge", () => {
    expect(computeUserScore([])).toEqual({
      score: 50,
      skill: 0,
      nResolved: 0,
      nWins: 0,
      hitRate: null,
      tier: "new",
    });
  });

  it("gives 50 to someone who wins exactly as often as the odds say", () => {
    // Ten picks at 0.60, six wins: a 60% hit rate but no edge over the market.
    const calls = Array.from({ length: 10 }, (_, i) => ({ oddsAtCall: 0.6, won: i < 6 }));
    const s = computeUserScore(calls);
    expect(s.score).toBe(50);
    expect(s.hitRate).toBeCloseTo(0.6);
    expect(s.tier).toBe("scored");
  });

  it("reaches about 88 with a sustained edge of +0.15 per call", () => {
    const points = Array.from({ length: 1000 }, () => 0.15);
    expect(scoreFromSkill(skillFromPoints(points))).toBe(88);
  });

  it("three lucky 0.30 underdog wins score 90 at k=10 and 77 at k=20, hidden behind New", () => {
    const calls = Array.from({ length: 3 }, () => ({ oddsAtCall: 0.3, won: true }));
    expect(computeUserScore(calls, 10)).toMatchObject({ score: 90, tier: "new" });
    expect(computeUserScore(calls, 20)).toMatchObject({ score: 77, tier: "new" });
  });

  it("switches from New to a number at 5 resolved calls", () => {
    const call = { oddsAtCall: 0.5, won: true };
    expect(computeUserScore(Array(4).fill(call)).tier).toBe("new");
    expect(computeUserScore(Array(5).fill(call)).tier).toBe("scored");
  });

  it("stays within 0 to 100 for extreme records", () => {
    const lossesOnLocks = Array.from({ length: 500 }, () => ({ oddsAtCall: 0.99, won: false }));
    const winsOnLongshots = Array.from({ length: 500 }, () => ({ oddsAtCall: 0.01, won: true }));
    expect(computeUserScore(lossesOnLocks).score).toBe(0);
    expect(computeUserScore(winsOnLongshots).score).toBe(100);
  });
});

describe("scoreChange14d", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  it("compares against the latest snapshot at least 14 days old", () => {
    const snapshots = [
      { score: 60, computedAt: ago(20) },
      { score: 65, computedAt: ago(15) },
      { score: 80, computedAt: ago(10) },
    ];
    expect(scoreChange14d(72, snapshots, now)).toBe(7);
  });

  it("counts a snapshot exactly 14 days old", () => {
    expect(scoreChange14d(41, [{ score: 47, computedAt: ago(14) }], now)).toBe(-6);
  });

  it("is null when no snapshot is 14 days old yet", () => {
    expect(scoreChange14d(72, [{ score: 50, computedAt: ago(13) }], now)).toBeNull();
    expect(scoreChange14d(72, [], now)).toBeNull();
  });
});

describe("changeArrow", () => {
  it("shows up and down arrows with the size of the change", () => {
    expect(changeArrow(8)).toEqual({ direction: "up", amount: 8 });
    expect(changeArrow(-6)).toEqual({ direction: "down", amount: 6 });
  });
  it("hides the arrow for changes under 2 points or with no baseline", () => {
    expect(changeArrow(1)).toBeNull();
    expect(changeArrow(-1)).toBeNull();
    expect(changeArrow(0)).toBeNull();
    expect(changeArrow(null)).toBeNull();
  });
  it("shows the arrow at exactly 2 points", () => {
    expect(changeArrow(2)).toEqual({ direction: "up", amount: 2 });
  });
});
