import type { PickMatch, Sentiment } from "@copayme/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { PIPELINE_VERSION, type ScoutPostRow, type ScoutStore } from "../src/store.js";

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
    pipelineVersion: PIPELINE_VERSION,
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

    it("finishScan with fetched: false keeps scannedAt (the last fetch from X)", async () => {
      await store.tryLock("alice", T0);
      await store.finishScan("alice", { newestTweetId: "99", xUserId: "u1", now: T0 });
      await store.tryLock("alice", new Date(T0.getTime() + MIN));
      await store.finishScan("alice", { newestTweetId: null, xUserId: null, now: new Date(T0.getTime() + 2 * MIN), fetched: false });
      const row = await store.getHandle("alice");
      expect(row).toMatchObject({ status: "idle", newestTweetId: "99", lockedAt: null });
      expect(row?.scannedAt).toEqual(T0);
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

    it("upsertPosts saves a large batch in one call, last row winning for a repeated id", async () => {
      const many = Array.from({ length: 450 }, (_, i) =>
        post({ tweetId: String(i), tweetedAt: new Date(T0.getTime() - i * MIN), text: `t${i}` }),
      );
      await store.upsertPosts([...many, post({ tweetId: "7", text: "replaced" })]);
      const rows = await store.listPosts("alice");
      expect(rows).toHaveLength(450);
      expect(rows.find((r) => r.tweetId === "7")?.text).toBe("replaced");
      expect(rows.find((r) => r.tweetId === "449")?.text).toBe("t449");
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

    it("pendingPosts also returns rows from an older pipeline version", async () => {
      await store.upsertPosts([
        post({ tweetId: "old-done", sentiment: sentiment(false, 0.9), matches: [], pipelineVersion: 0 }),
        post({ tweetId: "current-done", sentiment: sentiment(false, 0.9), matches: [] }),
      ]);
      const ids = (await store.pendingPosts("alice")).map((r) => r.tweetId);
      expect(ids).toEqual(["old-done"]);
    });

    it("pendingPosts returns a version-4 golf post read as no prediction, but not other version-4 posts", async () => {
      await store.upsertPosts([
        post({ tweetId: "golf", text: "golf the RSM Classic Winner is Michael Thorbjornsen", sentiment: sentiment(false, 0), matches: [], pipelineVersion: 4 }),
        post({ tweetId: "other", text: "what a game", sentiment: sentiment(false, 0.9), matches: [], pipelineVersion: 4 }),
        post({ tweetId: "golf-current", text: "golf: Scheffler wins", sentiment: sentiment(false, 0.9), matches: [] }),
      ]);
      const ids = (await store.pendingPosts("alice")).map((r) => r.tweetId);
      expect(ids).toEqual(["golf"]);
    });

    it("pendingPosts also returns rows matched under a rule that has changed ('tweet during game')", async () => {
      const noMarket = (reason: string) => [
        { predictionIndex: 0, status: "no_market" as const, reason, geminiEventTicker: null, gameTicker: null, instrumentSymbol: null, contractLabel: null, side: null, gameStartTime: null, marketStatus: null, resolutionSide: null },
      ];
      await store.upsertPosts([
        post({ tweetId: "live", sentiment: sentiment(true, 0.9), matches: noMarket("tweet during game") }),
        post({ tweetId: "final", sentiment: sentiment(true, 0.9), matches: noMarket("no contract at the tweet's line") }),
      ]);
      const ids = (await store.pendingPosts("alice")).map((r) => r.tweetId);
      expect(ids).toEqual(["live"]);
    });

    it("pendingPosts re-checks a college 'no line' pick once if it wasn't checked in both college sports", async () => {
      const noMarket = (reason: string) => [
        { predictionIndex: 0, status: "no_market" as const, reason, geminiEventTicker: null, gameTicker: null, instrumentSymbol: null, contractLabel: null, side: null, gameStartTime: null, marketStatus: null, resolutionSide: null },
      ];
      const college = (text: string, league: string): Sentiment => ({
        isPrediction: true,
        confidence: 0.9,
        model: "test",
        predictions: [
          { betType: "spread", league, team: { name: "Temple Owls", aliases: ["Temple"] }, opponent: null, player: null, metric: null, line: 4.5, claim: "covers", lineAsWritten: "-4.5", conviction: "lean", quote: text },
        ],
      });
      await store.upsertPosts([
        post({ tweetId: "old", text: "take temple -4.5", sentiment: college("take temple -4.5", "NCAAM"), matches: noMarket("no contract at the tweet's line") }),
        post({ tweetId: "named", text: "CBB 🏀 take temple -4.5", sentiment: college("take temple -4.5", "NCAAM"), matches: noMarket("no contract at the tweet's line") }),
        post({ tweetId: "checked", text: "take temple -4.5", sentiment: college("take temple -4.5", "NCAAM"), matches: noMarket("no contract at the tweet's line in football or basketball") }),
        post({ tweetId: "pro", text: "Lakers -4.5", sentiment: college("Lakers -4.5", "NBA"), matches: noMarket("no contract at the tweet's line") }),
      ]);
      const ids = (await store.pendingPosts("alice")).map((r) => r.tweetId);
      expect(ids).toEqual(["old"]);
    });

    it("unforwardedPosts and markForwarded", async () => {
      await store.upsertPosts([post({ tweetId: "1" }), post({ tweetId: "2" })]);
      await store.markForwarded(["1"], T0);
      expect((await store.unforwardedPosts("alice")).map((r) => r.tweetId)).toEqual(["2"]);
      expect((await store.listPosts("alice")).find((r) => r.tweetId === "1")?.forwardedAt).toEqual(T0);
      await store.markForwarded([], T0);
    });
  });

  describe("marketsToRefresh", () => {
    const HOUR = 60 * MIN;
    const started = new Date(T0.getTime() - 3 * HOUR).toISOString();
    const later = new Date(T0.getTime() + 3 * HOUR).toISOString();
    const pick = (ticker: string, gameStartTime: string, status: "matched" | "no_market" = "matched"): PickMatch => ({
      predictionIndex: 0,
      status,
      reason: null,
      geminiEventTicker: ticker,
      gameTicker: ticker,
      instrumentSymbol: `${ticker}-X`,
      contractLabel: "X",
      side: "yes",
      gameStartTime,
      marketStatus: "open",
      resolutionSide: null,
    });
    const market = (ticker: string, status: "open" | "resolved" | "void") => ({
      geminiMarketId: ticker,
      sport: "basketball",
      eventName: ticker,
      outcomes: [],
      lockTime: T0,
      status,
      winningOutcome: null,
      resolvedAt: null,
    });

    it("lists each started, unsettled market behind a forwarded pick once", async () => {
      await store.upsertPosts([
        post({ tweetId: "1", matches: [pick("MKT-OPEN", started)], forwardedAt: T0 }),
        post({ tweetId: "2", matches: [pick("MKT-OPEN", started), pick("MKT-NOROW", started)], forwardedAt: T0 }),
        post({ tweetId: "3", matches: [pick("MKT-FUTURE", later)], forwardedAt: T0 }),
        post({ tweetId: "4", matches: [pick("MKT-UNSENT", started)], forwardedAt: null }),
        post({ tweetId: "5", matches: [pick("MKT-DONE", started), pick("MKT-VOID", started)], forwardedAt: T0 }),
        post({ tweetId: "6", matches: [pick("MKT-NOMATCH", started, "no_market")], forwardedAt: T0 }),
      ]);
      for (const m of [market("MKT-OPEN", "open"), market("MKT-DONE", "resolved"), market("MKT-VOID", "void")]) {
        await store.upsertMarket(m);
      }
      const got = (await store.marketsToRefresh(T0, 100)).map((m) => m.geminiEventTicker).sort();
      expect(got).toEqual(["MKT-NOROW", "MKT-OPEN"]);
      expect(await store.marketsToRefresh(T0, 1)).toHaveLength(1);
    });
  });
}
