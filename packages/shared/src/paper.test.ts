import { describe, expect, it } from "vitest";
import { contractsFor, paperPnlUsdc, resolvedExitPrice } from "./paper.js";

describe("paperPnlUsdc", () => {
  it("wins pay out the full contract value", () => {
    expect(paperPnlUsdc({ amountUsdc: 10, entryOdds: 0.5, exitPrice: 1 })).toBe(10);
    expect(paperPnlUsdc({ amountUsdc: 10, entryOdds: 0.25, exitPrice: 1 })).toBe(30);
  });

  it("losses lose the whole stake", () => {
    expect(paperPnlUsdc({ amountUsdc: 10, entryOdds: 0.5, exitPrice: 0 })).toBe(-10);
    expect(paperPnlUsdc({ amountUsdc: 10, entryOdds: 0.25, exitPrice: 0 })).toBe(-10);
  });

  it("marks to market between 0 and 1", () => {
    expect(paperPnlUsdc({ amountUsdc: 10, entryOdds: 0.5, exitPrice: 0.6 })).toBe(2);
    expect(paperPnlUsdc({ amountUsdc: 10, entryOdds: 0.5, exitPrice: 0.4 })).toBe(-2);
  });

  it("rounds to cents", () => {
    // 1 * (1 - 0.3) / 0.3 = 2.333… -> 2.33
    expect(paperPnlUsdc({ amountUsdc: 1, entryOdds: 0.3, exitPrice: 1 })).toBe(2.33);
  });

  it("throws for entryOdds <= 0 or > 1", () => {
    expect(() => paperPnlUsdc({ amountUsdc: 10, entryOdds: 0, exitPrice: 1 })).toThrow(RangeError);
    expect(() => paperPnlUsdc({ amountUsdc: 10, entryOdds: -0.1, exitPrice: 1 })).toThrow(RangeError);
    expect(() => paperPnlUsdc({ amountUsdc: 10, entryOdds: 1.1, exitPrice: 1 })).toThrow(RangeError);
  });

  it("throws for exitPrice outside [0,1]", () => {
    expect(() => paperPnlUsdc({ amountUsdc: 10, entryOdds: 0.5, exitPrice: -0.01 })).toThrow(RangeError);
    expect(() => paperPnlUsdc({ amountUsdc: 10, entryOdds: 0.5, exitPrice: 1.01 })).toThrow(RangeError);
  });
});

describe("contractsFor", () => {
  it("divides the stake by the entry price", () => {
    expect(contractsFor(10, 0.5)).toBe(20);
    expect(contractsFor(10, 0.25)).toBe(40);
  });

  it("throws for entryOdds <= 0 or > 1", () => {
    expect(() => contractsFor(10, 0)).toThrow(RangeError);
    expect(() => contractsFor(10, -0.5)).toThrow(RangeError);
    expect(() => contractsFor(10, 1.5)).toThrow(RangeError);
  });
});

describe("resolvedExitPrice", () => {
  it("is 1 when our side won, 0 when it lost", () => {
    expect(resolvedExitPrice("yes", "yes")).toBe(1);
    expect(resolvedExitPrice("yes", "no")).toBe(0);
    expect(resolvedExitPrice("no", "no")).toBe(1);
    expect(resolvedExitPrice("no", "yes")).toBe(0);
  });

  it("is null when either side is unknown", () => {
    expect(resolvedExitPrice("yes", null)).toBeNull();
    expect(resolvedExitPrice("no", null)).toBeNull();
    expect(resolvedExitPrice(null, "yes")).toBeNull();
    expect(resolvedExitPrice(null, null)).toBeNull();
  });
});
