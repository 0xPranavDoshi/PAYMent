import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBatcher } from "./batcher.js";

describe("createBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends one request for handles added in a burst", () => {
    const flush = vi.fn();
    const batcher = createBatcher(flush, 150);
    batcher.add("a");
    vi.advanceTimersByTime(100);
    batcher.add("b");
    vi.advanceTimersByTime(100);
    expect(flush).not.toHaveBeenCalled(); // the second add restarted the wait
    vi.advanceTimersByTime(60);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(["a", "b"]);
  });

  it("dedupes and starts a fresh batch after a flush", () => {
    const flush = vi.fn();
    const batcher = createBatcher(flush, 150);
    batcher.add("a");
    batcher.add("a");
    vi.advanceTimersByTime(150);
    batcher.add("b");
    vi.advanceTimersByTime(150);
    expect(flush).toHaveBeenNthCalledWith(1, ["a"]);
    expect(flush).toHaveBeenNthCalledWith(2, ["b"]);
  });
});
