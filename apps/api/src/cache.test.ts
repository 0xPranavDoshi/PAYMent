import { describe, expect, it } from "vitest";
import { TtlLru } from "./cache.js";

describe("TtlLru", () => {
  it("expires entries after the ttl", () => {
    let t = 0;
    const cache = new TtlLru<number>(10, 1000, () => t);
    cache.set("a", 1);
    t = 999;
    expect(cache.get("a")).toEqual({ value: 1 });
    t = 1000;
    expect(cache.get("a")).toBeUndefined();
  });

  it("tells a cached null apart from a miss", () => {
    const cache = new TtlLru<null>(10, 1000);
    cache.set("a", null);
    expect(cache.get("a")).toEqual({ value: null });
    expect(cache.get("b")).toBeUndefined();
  });

  it("drops the least recently used entry past max", () => {
    const cache = new TtlLru<number>(2, 1000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // a is now more recent than b
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toEqual({ value: 1 });
    expect(cache.get("c")).toEqual({ value: 3 });
    expect(cache.size).toBe(2);
  });
});
