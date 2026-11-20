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
  const startedFromNothing: CopyOverride = { value: copying10, basis: copyBasis(null), viewer: "user-a" };

  it("shows page data when there is no override", () => {
    expect(resolveCopy(undefined, null, "user-a")).toEqual({ copy: null, drop: false });
    expect(resolveCopy(undefined, copying10, "user-a")).toEqual({ copy: copying10, drop: false });
  });

  it("shows the override while the page still has the data it was set against", () => {
    expect(resolveCopy(startedFromNothing, null, "user-a")).toEqual({ copy: copying10, drop: false });
  });

  it("lets page data win, and drops the override, once the page data changes", () => {
    const fromServer = { active: true, amountUsdc: 25, since: "2026-11-01T00:00:00Z" };
    expect(resolveCopy(startedFromNothing, fromServer, "user-a")).toEqual({ copy: fromServer, drop: true });
    // a stop made elsewhere: the page now says inactive
    const stopped: CopyOverride = { value: copying10, basis: copyBasis({ active: true, amountUsdc: 5 }), viewer: "user-a" };
    expect(resolveCopy(stopped, { active: false, amountUsdc: 5 }, "user-a")).toEqual({ copy: { active: false, amountUsdc: 5 }, drop: true });
  });

  it("never shows an override to a signed-out viewer", () => {
    expect(resolveCopy(startedFromNothing, null, null)).toEqual({ copy: null, drop: true });
  });

  it("never shows one viewer's override to another, even when their page data matches its basis", () => {
    // A (not copying before) copied @x, so basis is "none"; B is not copying @x either, so B's page data is null too.
    expect(copyBasis(null)).toBe(startedFromNothing.basis);
    expect(resolveCopy(startedFromNothing, null, "user-b")).toEqual({ copy: null, drop: true });
  });
});
