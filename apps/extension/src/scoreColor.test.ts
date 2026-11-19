import { describe, expect, it } from "vitest";
import { scoreHue } from "./scoreColor.js";

describe("scoreHue", () => {
  it("runs from red at the bottom to green at the top", () => {
    expect(scoreHue(0)).toBeLessThan(15); // red
    expect(scoreHue(100)).toBeGreaterThan(130); // green
  });

  it("puts the middle in orange and yellow territory", () => {
    expect(scoreHue(50)).toBeGreaterThan(30);
    expect(scoreHue(50)).toBeLessThan(55);
  });

  it("is already clearly green for a good score, and still red for a poor one", () => {
    expect(scoreHue(72)).toBeGreaterThan(90);
    expect(scoreHue(15)).toBeLessThan(25);
  });

  it("only ever moves toward green as the score goes up", () => {
    let previous = scoreHue(0);
    for (let s = 1; s <= 100; s++) {
      const hue = scoreHue(s);
      expect(hue).toBeGreaterThanOrEqual(previous);
      previous = hue;
    }
  });

  it("clamps scores outside 0 to 100", () => {
    expect(scoreHue(-20)).toBe(scoreHue(0));
    expect(scoreHue(250)).toBe(scoreHue(100));
  });
});
