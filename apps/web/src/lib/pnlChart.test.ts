import { describe, expect, it } from "vitest";
import { pnlGeometry } from "./pnlChart";

const pts = (...v: number[]) => v.map((cumulative) => ({ cumulative }));
const nums = (path: string) => (path.match(/-?\d+(\.\d+)?(e-?\d+)?/gi) ?? []).map(Number);
const MOCK = [0, 0.64, 0.34, 1.26, -0.74, 0.36, 0.84, 0.84, 2.19, 1.57, 3.28, 3.68, 3.3, 4.82];

describe("pnlGeometry", () => {
  it("returns empty paths and no last point for no data", () => {
    const g = pnlGeometry([], 930, 208);
    expect(g.line).toBe("");
    expect(g.area).toBe("");
    expect(g.last).toBeNull();
    expect(Number.isFinite(g.zeroY)).toBe(true);
  });

  it("draws a flat line across the width for one point", () => {
    const g = pnlGeometry(pts(2), 930, 208);
    expect(g.line).not.toContain("NaN");
    expect(g.last).not.toBeNull();
    expect(g.zeroY).toBeGreaterThan(g.last!.y);
    expect(g.last!.x).toBe(930);
    expect(nums(g.line).every(Number.isFinite)).toBe(true);
  });

  it("keeps zero above every point of an all-negative series", () => {
    const g = pnlGeometry(pts(-1, -3, -2), 930, 208);
    const ys = nums(g.line).filter((_, i) => i % 2 === 1);
    expect(ys.every((y) => g.zeroY < y)).toBe(true);
    expect(g.ticks.map((t) => t.value)).toContain(0);
  });

  it("produces finite coordinates for an all-positive series", () => {
    const g = pnlGeometry(pts(1, 2, 5, 3), 930, 208);
    expect(nums(g.line).every(Number.isFinite)).toBe(true);
    expect(nums(g.area).every(Number.isFinite)).toBe(true);
    expect(g.xs).toHaveLength(4);
  });

  it("handles the mockup series", () => {
    const g = pnlGeometry(pts(...MOCK), 930, 208);
    expect(g.last!.y).toBeLessThan(g.zeroY);
    expect(g.ticks.map((t) => t.value)).toContain(0);
    expect(g.ticks.length).toBeGreaterThanOrEqual(4);
    expect(g.ticks.length).toBeLessThanOrEqual(5);
    expect(g.ticks.every((t) => Number.isFinite(t.y))).toBe(true);
  });

  it("survives an all-zero series", () => {
    const g = pnlGeometry(pts(0, 0), 930, 208);
    expect(nums(g.line).every(Number.isFinite)).toBe(true);
    expect(g.ticks.map((t) => t.value)).toContain(0);
  });
});
