import { describe, expect, it } from "vitest";
import { MAX_COPY_PICK_AGE_S, isFreshForCopy } from "./copy.js";

const now = new Date("2026-11-19T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);

describe("isFreshForCopy", () => {
  it("accepts a pick up to the limit and rejects anything older", () => {
    expect(isFreshForCopy(ago(0), now)).toBe(true);
    expect(isFreshForCopy(ago(MAX_COPY_PICK_AGE_S), now)).toBe(true);
    expect(isFreshForCopy(ago(MAX_COPY_PICK_AGE_S + 1), now)).toBe(false);
    expect(isFreshForCopy(ago(3 * 24 * 3600), now)).toBe(false);
  });

  it("takes ISO strings and treats a future tweet time as fresh", () => {
    expect(isFreshForCopy(ago(60).toISOString(), now)).toBe(true);
    expect(isFreshForCopy(new Date(now.getTime() + 5000), now)).toBe(true);
  });
});
