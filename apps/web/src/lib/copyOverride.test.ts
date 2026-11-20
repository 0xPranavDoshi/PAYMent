import { describe, expect, it } from "vitest";
import { copyBasis, resolveCopy, type CopyOverride } from "./copyOverride";

const copying10 = { active: true, amountUsdc: 10, since: "2026-11-19T00:00:00Z" };

describe("copyBasis", () => {
  it("fingerprints active and amount only", () => {
    expect(copyBasis(null)).toBe("none");
    expect(copyBasis({ active: true, amountUsdc: 10 })).toBe(copyBasis(copying10));
    expect(copyBasis({ active: false, amountUsdc: 10 })).not.toBe(copyBasis(copying10));
    expect(copyBasis({ active: true, amountUsdc: 25 })).not.toBe(copyBasis(copying10));
  });
});

describe("resolveCopy", () => {
  const startedFromNothing: CopyOverride = { value: copying10, basis: copyBasis(null) };

  it("shows page data when there is no override", () => {
    expect(resolveCopy(undefined, null, true)).toEqual({ copy: null, drop: false });
    expect(resolveCopy(undefined, copying10, true)).toEqual({ copy: copying10, drop: false });
  });

  it("shows the override while the page still has the data it was set against", () => {
    expect(resolveCopy(startedFromNothing, null, true)).toEqual({ copy: copying10, drop: false });
  });

  it("lets page data win, and drops the override, once the page data changes", () => {
    const fromServer = { active: true, amountUsdc: 25, since: "2026-11-01T00:00:00Z" };
    expect(resolveCopy(startedFromNothing, fromServer, true)).toEqual({ copy: fromServer, drop: true });
    // a stop made elsewhere: the page now says inactive
    const stopped: CopyOverride = { value: copying10, basis: copyBasis({ active: true, amountUsdc: 5 }) };
    expect(resolveCopy(stopped, { active: false, amountUsdc: 5 }, true)).toEqual({ copy: { active: false, amountUsdc: 5 }, drop: true });
  });

  it("never shows an override to a signed-out viewer", () => {
    expect(resolveCopy(startedFromNothing, null, false)).toEqual({ copy: null, drop: true });
  });
});
