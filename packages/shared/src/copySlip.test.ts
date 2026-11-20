import { describe, expect, it } from "vitest";
import type { CallEntry } from "./calls.js";
import { pastWeekEarnings, recentSettled, snapToStep, stepAmount } from "./copySlip.js";

const now = new Date("2026-11-19T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const call = (p: Partial<CallEntry>): CallEntry => ({
  callId: crypto.randomUUID(),
  tweetId: "1",
  tweetedAt: daysAgo(1),
  tweetText: "",
  eventName: "E",
  pickLabel: "P",
  side: "yes",
  oddsAtCall: 0.5,
  oddsSource: "history",
  status: "scored",
  result: "won",
  points: 0.5,
  ...p,
});

describe("copySlip", () => {
  it("matches the mockup's past week: 5 picks at $10 = +$15.81", () => {
    const calls = [
      call({ oddsAtCall: 0.55, result: "lost" }),
      call({ oddsAtCall: 0.35 }),
      call({ oddsAtCall: 0.58 }),
      call({ oddsAtCall: 0.45, result: "lost" }),
      call({ oddsAtCall: 0.5 }),
    ];
    expect(pastWeekEarnings(calls, 10, now)).toBe(15.81);
  });
  it("a win at 52¢ for $10 earns $9.23", () =>
    expect(pastWeekEarnings([call({ oddsAtCall: 0.52 })], 10, now)).toBe(9.23));
  it("skips pending, void, unpriced, 0 and 1 prices, and picks older than 7 days", () => {
    const skipped = [
      call({ result: null, status: "pending" }),
      call({ status: "void", result: null }),
      call({ oddsAtCall: null }),
      call({ oddsAtCall: 0 }),
      call({ oddsAtCall: 1 }),
      call({ tweetedAt: daysAgo(8) }),
    ];
    expect(pastWeekEarnings(skipped, 10, now)).toBeNull();
    expect(pastWeekEarnings([...skipped, call({ result: "lost" })], 10, now)).toBe(-10);
  });
  it("snapToStep / stepAmount", () => {
    expect(snapToStep(7)).toBe(5);
    expect(snapToStep(7.5)).toBe(10);
    expect(snapToStep(0.5)).toBe(1);
    expect(snapToStep(500)).toBe(100);
    expect(stepAmount(10, 1)).toBe(25);
    expect(stepAmount(10, -1)).toBe(5);
    expect(stepAmount(1, -1)).toBe(1);
    expect(stepAmount(100, 1)).toBe(100);
    expect(stepAmount(7, 1)).toBe(10);
  });
  it("recentSettled returns the 3 newest settled picks", () => {
    const r = recentSettled([
      call({ tweetedAt: daysAgo(5), pickLabel: "old" }),
      call({ result: null }),
      call({ tweetedAt: daysAgo(1), pickLabel: "a" }),
      call({ tweetedAt: daysAgo(2), pickLabel: "b" }),
      call({ tweetedAt: daysAgo(3), pickLabel: "c" }),
    ]);
    expect(r.map((c) => c.pickLabel)).toEqual(["a", "b", "c"]);
  });
});
