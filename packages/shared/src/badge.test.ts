import { describe, expect, it } from "vitest";
import { Badge, badgeFromProfile } from "./badge.js";

describe("badgeFromProfile", () => {
  it("keeps exactly the badge's fields, dropping the rest of the profile", () => {
    const profile = { score: 60, change14d: null, tier: "scored" as const, nResolved: 6, hitRate: 5 / 6, handle: "x", nWins: 5, skill: 0.03, lastCallAt: null };
    const badge = badgeFromProfile(profile);
    expect(badge).toEqual({ score: 60, change14d: null, tier: "scored", nResolved: 6, hitRate: 5 / 6 });
    expect(Badge.safeParse(badge).success).toBe(true);
  });
});
