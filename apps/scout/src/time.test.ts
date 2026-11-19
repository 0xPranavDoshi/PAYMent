import { describe, expect, it } from "vitest";
import fixture from "../test/fixtures/apify-kaito.json" with { type: "json" };
import { tweetIdToDate } from "./time.js";

describe("tweetIdToDate", () => {
  it("decodes the snowflake timestamp", () => {
    expect(tweetIdToDate("1795019520000000000")).toEqual(
      new Date(Number((1795019520000000000n >> 22n) + 1288834974657n)),
    );
  });

  it("matches the provider createdAt within 60s for fixture ids", () => {
    for (const item of fixture) {
      const diff = Math.abs(tweetIdToDate(item.id).getTime() - Date.parse(item.createdAt));
      expect(diff).toBeLessThan(60_000);
    }
  });
});
