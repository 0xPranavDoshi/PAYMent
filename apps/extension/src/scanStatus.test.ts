import { describe, expect, it, vi } from "vitest";
import { createScanStatusStore, formatElapsed } from "./scanStatus.js";

describe("formatElapsed", () => {
  it("reads like a stopwatch", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_400)).toBe("0:07");
    expect(formatElapsed(61_000)).toBe("1:01");
    expect(formatElapsed(161_900)).toBe("2:41");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("createScanStatusStore", () => {
  it("holds one status and tells subscribers when it changes", () => {
    const store = createScanStatusStore();
    const notify = vi.fn();
    const off = store.subscribe(notify);
    expect(store.get()).toBeNull();
    store.set({ phase: "scanning", handle: "dana", startedAt: 1 });
    expect(store.get()).toMatchObject({ phase: "scanning", handle: "dana" });
    expect(notify).toHaveBeenCalledTimes(1);
    off();
    store.set(null);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
