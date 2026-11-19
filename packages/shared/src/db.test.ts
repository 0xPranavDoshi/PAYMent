import { describe, expect, it } from "vitest";
import { DEFAULT_DB_POOL_MAX, dbPoolMax } from "./db.js";

describe("dbPoolMax", () => {
  it("uses a small default so several services fit under one pooler limit", () => {
    expect(dbPoolMax(undefined)).toBe(DEFAULT_DB_POOL_MAX);
    expect(DEFAULT_DB_POOL_MAX).toBeLessThanOrEqual(4);
  });
  it("reads a positive whole number", () => {
    expect(dbPoolMax("6")).toBe(6);
    expect(dbPoolMax(" 2 ")).toBe(2);
  });
  it("falls back for anything else", () => {
    for (const bad of ["", "0", "-1", "abc", "2.5", "1e3"]) expect(dbPoolMax(bad)).toBe(DEFAULT_DB_POOL_MAX);
    expect(dbPoolMax("nope", 5)).toBe(5);
  });
});
