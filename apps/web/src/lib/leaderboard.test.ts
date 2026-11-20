import { describe, expect, it } from "vitest";
import type { LeaderboardEntry } from "./api";
import { FILTERS, podiumOrder, rankOf } from "./leaderboard";

const e = (o: Partial<LeaderboardEntry>): LeaderboardEntry => ({
  handle: "x", score: 50, change14d: null, nResolved: 10, hitRate: 0.5, tier: "scored", skill: 0, ...o,
});
const test = (id: string) => FILTERS.find((f) => f.id === id)!.test;

describe("podiumOrder", () => {
  it("puts #1 in the middle", () => {
    expect(podiumOrder(["a", "b", "c"])).toEqual(["b", "a", "c"]);
    expect(podiumOrder(["a", "b"])).toEqual(["b", "a"]);
    expect(podiumOrder(["a"])).toEqual(["a"]);
    expect(podiumOrder([])).toEqual([]);
  });
});

describe("FILTERS", () => {
  it("has the four labelled filters", () => {
    expect(FILTERS.map((f) => f.label)).toEqual(["All", "Beating market", "Rising", "New"]);
  });
  it("beating needs a scored trader with positive edge", () => {
    expect(test("beating")(e({ tier: "scored", skill: 0.02 }))).toBe(true);
    expect(test("beating")(e({ tier: "scored", skill: 0 }))).toBe(false);
    expect(test("beating")(e({ tier: "new", skill: 0.02 }))).toBe(false);
  });
  it("rising needs +2 in 14 days; new needs the new tier", () => {
    expect(test("rising")(e({ change14d: 2 }))).toBe(true);
    expect(test("rising")(e({ change14d: 1 }))).toBe(false);
    expect(test("rising")(e({ change14d: null }))).toBe(false);
    expect(test("new")(e({ tier: "new" }))).toBe(true);
    expect(test("all")(e({}))).toBe(true);
  });
});

describe("rankOf", () => {
  const board = [e({ handle: "a" }), e({ handle: "b" }), e({ handle: "c" })];
  it("finds a handle's rank", () => {
    expect(rankOf(board, "b")).toEqual({ rank: 2, total: 3 });
    expect(rankOf(board, "zzz")).toBeNull();
  });
});
