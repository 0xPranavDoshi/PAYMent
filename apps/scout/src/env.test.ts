import { describe, expect, it } from "vitest";
import { positiveIntOr } from "./env.js";

describe("positiveIntOr", () => {
  it("returns the parsed value for a positive integer", () => {
    expect(positiveIntOr("45", 30)).toBe(45);
    expect(positiveIntOr(" 8790 ", 8789)).toBe(8790);
  });

  it("returns the default for missing, empty, zero, negative, fractional or junk values", () => {
    for (const v of [undefined, "", "0", "-3", "2.5", "abc", "12abc", "1e3", "Infinity"]) {
      expect(positiveIntOr(v, 30)).toBe(30);
    }
  });
});
