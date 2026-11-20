import { describe, expect, it } from "vitest";
import { DEFAULT_DB_IDLE_TIMEOUT_S, DEFAULT_DB_POOL_MAX, dbIdleTimeout, dbPoolMax } from "./db.js";

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

describe("dbIdleTimeout", () => {
  it("closes idle connections after a short while by default, so a quiet service holds none", () => {
    expect(dbIdleTimeout(undefined)).toBe(DEFAULT_DB_IDLE_TIMEOUT_S);
    expect(DEFAULT_DB_IDLE_TIMEOUT_S).toBeGreaterThan(0);
    expect(DEFAULT_DB_IDLE_TIMEOUT_S).toBeLessThanOrEqual(60);
  });
  it("reads whole seconds, and 0 to turn it off", () => {
    expect(dbIdleTimeout("45")).toBe(45);
    expect(dbIdleTimeout(" 10 ")).toBe(10);
    expect(dbIdleTimeout("0")).toBe(0);
  });
  it("falls back for anything else", () => {
    for (const bad of ["", "-1", "abc", "2.5", "1e3"]) expect(dbIdleTimeout(bad)).toBe(DEFAULT_DB_IDLE_TIMEOUT_S);
    expect(dbIdleTimeout("nope", 5)).toBe(5);
  });
});
