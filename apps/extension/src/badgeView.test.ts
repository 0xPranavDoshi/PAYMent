import { describe, expect, it } from "vitest";
import { badgeView } from "./badgeView.js";

const scored = { score: 72, change14d: 8, tier: "scored" as const, nResolved: 30, hitRate: 0.6333 };

describe("badgeView", () => {
  it("draws nothing while loading or for unknown handles", () => {
    expect(badgeView(undefined)).toBeNull();
    expect(badgeView(null)).toBeNull();
  });

  it("shows the score with an up arrow", () => {
    expect(badgeView(scored)).toMatchObject({
      kind: "scored",
      text: "72",
      arrow: { direction: "up", amount: 8 },
      title: "Score 72 of 100 · 30 resolved picks · 63% hit rate",
    });
  });

  it("shows a down arrow for a falling score", () => {
    expect(badgeView({ ...scored, change14d: -6 })?.arrow).toEqual({ direction: "down", amount: 6 });
  });

  it("hides the arrow for small or unknown changes", () => {
    expect(badgeView({ ...scored, change14d: 1 })?.arrow).toBeNull();
    expect(badgeView({ ...scored, change14d: null })?.arrow).toBeNull();
  });

  it("shows New instead of a number under 5 resolved picks", () => {
    const view = badgeView({ score: 63, change14d: null, tier: "new", nResolved: 1, hitRate: 1 });
    expect(view).toMatchObject({ kind: "new", text: "New", arrow: null });
    expect(view?.title).toBe("1 resolved pick so far. A score appears at 5.");
  });

  it("omits the hit rate when there are no resolved picks", () => {
    expect(badgeView({ ...scored, hitRate: null })?.title).toBe("Score 72 of 100 · 30 resolved picks");
  });
});
