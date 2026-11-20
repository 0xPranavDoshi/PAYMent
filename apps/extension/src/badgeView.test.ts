import { describe, expect, it } from "vitest";
import { badgeView } from "./badgeView.js";

const scored = { score: 72, change14d: 8, tier: "scored" as const, nResolved: 30, hitRate: 0.6333 };

describe("badgeView", () => {
  it("draws nothing while loading or for unknown handles", () => {
    expect(badgeView(undefined)).toBeNull();
    expect(badgeView(null)).toBeNull();
  });

  it("shows Scanning… while the handle's posts are being read", () => {
    expect(badgeView("scanning")).toEqual({
      kind: "scanning",
      text: "Scanning…",
      meter: null,
      title: "Reading this account's recent picks…",
    });
  });

  it("shows the score with a meter filled to it in the score's band colour", () => {
    expect(badgeView(scored)).toMatchObject({
      kind: "scored",
      text: "72",
      meter: { pct: 72, band: "win" },
      title: "Score 72 of 100 · 30 resolved picks · 63% hit rate",
    });
  });

  it("colours the meter green from 60, amber from 40 and red below", () => {
    const band = (score: number) => badgeView({ ...scored, score })?.meter?.band;
    expect([band(60), band(59), band(40), band(39)]).toEqual(["win", "amber", "amber", "loss"]);
  });

  it("draws an empty red meter at 0 and a full one at 100", () => {
    expect(badgeView({ ...scored, score: 0 })?.meter).toEqual({ pct: 0, band: "loss" });
    expect(badgeView({ ...scored, score: 100 })?.meter).toEqual({ pct: 100, band: "win" });
  });

  it("shows New instead of a number under 5 resolved picks", () => {
    const view = badgeView({ score: 63, change14d: null, tier: "new", nResolved: 1, hitRate: 1 });
    expect(view).toMatchObject({ kind: "new", text: "New", meter: null });
    expect(view?.title).toBe("1 resolved pick so far. A score appears at 5.");
  });

  it("omits the hit rate when there are no resolved picks", () => {
    expect(badgeView({ ...scored, hitRate: null })?.title).toBe("Score 72 of 100 · 30 resolved picks");
  });
});

describe("badgeView: scan states", () => {
  it("offers Scan picks only on a profile page, for a handle we know nothing about", () => {
    expect(badgeView(null, { canScan: true })).toMatchObject({ kind: "offer", text: "Scan picks", meter: null });
    expect(badgeView(null, { canScan: false })).toBeNull();
    expect(badgeView(null)).toBeNull();
    expect(badgeView(undefined, { canScan: true })).toBeNull(); // not looked up yet: nothing to offer
  });

  it("says when a scan found no picks, and when it failed", () => {
    expect(badgeView("empty")).toMatchObject({ kind: "empty", text: "No picks found", meter: null });
    expect(badgeView("failed", { canScan: true })).toMatchObject({ kind: "failed", text: "Scan failed · Retry", meter: null });
  });
});
