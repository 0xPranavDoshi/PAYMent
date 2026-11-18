import type { Sentiment } from "@copayme/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { ScoutPostRow, ScoutStore } from "../src/store.js";

const T0 = new Date("2026-11-18T12:00:00Z");
const MIN = 60_000;

function sentiment(isPrediction: boolean, confidence: number): Sentiment {
  return { isPrediction, confidence, predictions: [], model: "test" };
}

function post(over: Partial<ScoutPostRow> = {}): ScoutPostRow {
  return {
    tweetId: "1",
    handle: "alice",
    xUserId: "u1",
    tweetedAt: new Date("2026-11-17T00:00:00Z"),
    text: "hello",
    isReply: false,
    quotedText: null,
    sentiment: null,
    matches: null,
    pipelineVersion: 1,
    forwardedAt: null,
    ...over,
  };
}

/** Behaviour every ScoutStore implementation must share. */
export function describeStore(make: () => ScoutStore): void {
  let store: ScoutStore;
  beforeEach(() => {
    store = make();
  });

  describe("handle lock", () => {
    it("locks a new handle once", async () => {
      expect(await store.tryLock("alice", T0)).toBe(true);
      expect(await store.tryLock("alice", T0)).toBe(false);
      expect((await store.getHandle("alice"))?.status).toBe("running");
    });

    it("takes over a stale lock after 5 minutes", async () => {
      await store.tryLock("alice", T0);
      expect(await store.tryLock("alice", new Date(T0.getTime() + 5 * MIN))).toBe(false);
      expect(await store.tryLock("alice", new Date(T0.getTime() + 5 * MIN + 1))).toBe(true);
    });

    it("can be locked again after finishScan, which records the result", async () => {
      await store.tryLock("alice", T0);
      const done = new Date(T0.getTime() + MIN);
      await store.finishScan("alice", { newestTweetId: "99", xUserId: "u1", now: done });
      const row = await store.getHandle("alice");
      expect(row).toMatchObject({ status: "idle", newestTweetId: "99", xUserId: "u1", lockedAt: null });
      expect(row?.scannedAt).toEqual(done);
      expect(await store.tryLock("alice", done)).toBe(true);
    });

    it("can be locked again after failScan, which records the error", async () => {
      await store.tryLock("alice", T0);
      await store.failScan("alice", "boom");
      expect(await store.getHandle("alice")).toMatchObject({ status: "failed", lastError: "boom" });
      expect(await store.tryLock("alice", T0)).toBe(true);
    });

    it("lets exactly one of two concurrent callers win", async () => {
      const results = await Promise.all([store.tryLock("bob", T0), store.tryLock("bob", T0)]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("returns null for an unknown handle", async () => {
      expect(await store.getHandle("nobody")).toBeNull();
    });
  });

  describe("countNewHandlesSince", () => {
    it("counts only handles created after since", async () => {
      await store.tryLock("old", new Date(T0.getTime() - 2 * 86_400_000));
      await store.tryLock("new1", T0);
      await store.tryLock("new2", new Date(T0.getTime() + MIN));
      expect(await store.countNewHandlesSince(new Date(T0.getTime() - 86_400_000))).toBe(2);
    });
  });

  describe("posts", () => {
    it("existingTweetIds returns only stored ids", async () => {
      await store.upsertPosts([post({ tweetId: "1" }), post({ tweetId: "2" })]);
      expect(await store.existingTweetIds(["1", "3", "2"])).toEqual(new Set(["1", "2"]));
      expect(await store.existingTweetIds([])).toEqual(new Set());
    });

    it("upsertPosts replaces a row with the same tweetId", async () => {
      await store.upsertPosts([post({ tweetId: "1", text: "a" })]);
      await store.upsertPosts([post({ tweetId: "1", text: "b", sentiment: sentiment(false, 0.9) })]);
      const rows = await store.listPosts("alice");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ text: "b", sentiment: sentiment(false, 0.9) });
    });

    it("lists newest first and round-trips fields", async () => {
      const older = post({ tweetId: "1", tweetedAt: new Date("2026-11-10T00:00:00Z") });
      const newer = post({
        tweetId: "2",
        tweetedAt: new Date("2026-11-12T00:00:00Z"),
        isReply: true,
        quotedText: "q",
        sentiment: sentiment(true, 0.9),
        matches: [],
      });
      await store.upsertPosts([older, newer, post({ tweetId: "3", handle: "other" })]);
      const rows = await store.listPosts("alice");
      expect(rows.map((r) => r.tweetId)).toEqual(["2", "1"]);
      expect(rows[0]).toEqual(newer);
    });

    it("pendingPosts returns unread posts and unmatched predictions only", async () => {
      await store.upsertPosts([
        post({ tweetId: "unread", sentiment: null }),
        post({ tweetId: "pred", sentiment: sentiment(true, 0.9), matches: null }),
        post({ tweetId: "weak", sentiment: sentiment(true, 0.5), matches: null }),
        post({ tweetId: "nonpred", sentiment: sentiment(false, 0.9), matches: null }),
        post({ tweetId: "done", sentiment: sentiment(true, 0.9), matches: [] }),
      ]);
      const ids = (await store.pendingPosts("alice")).map((r) => r.tweetId).sort();
      expect(ids).toEqual(["pred", "unread"]);
    });

    it("unforwardedPosts and markForwarded", async () => {
      await store.upsertPosts([post({ tweetId: "1" }), post({ tweetId: "2" })]);
      await store.markForwarded(["1"], T0);
      expect((await store.unforwardedPosts("alice")).map((r) => r.tweetId)).toEqual(["2"]);
      expect((await store.listPosts("alice")).find((r) => r.tweetId === "1")?.forwardedAt).toEqual(T0);
      await store.markForwarded([], T0);
    });
  });
}
