import { IngestResponse, MAX_COPY_PICK_AGE_S, MAX_POSTS_PER_REQUEST, type NewPost, type Pick } from "@copayme/shared";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import {
  MAX_PRICE_GAP_S,
  ingestPost,
  ingestPosts,
  lagSeconds,
  priceFor,
  type CallInput,
  type IngestDb,
  type IngestStore,
  type MarketRow,
} from "./ingest.js";

const T = (iso: string) => new Date(iso);
const SYNCED = T("2026-11-19T12:00:00Z");
const NOW = T("2026-11-19T12:05:00Z");

const market = (over: Partial<MarketRow> = {}): MarketRow => ({
  id: "m1",
  lockTime: T("2026-11-20T02:00:00Z"),
  status: "open",
  syncedAt: SYNCED,
  outcomes: [
    { label: "UConn", instrumentSymbol: "GEMI-UCONN", currentOdds: 0.62, noOdds: 0.4 },
    { label: "Arizona", instrumentSymbol: "GEMI-ARI", currentOdds: 0.38, noOdds: null },
  ],
  ...over,
});

const pick = (over: Partial<Pick> = {}): Pick => ({
  geminiEventTicker: "NCAAM-UCONN-ARI-M",
  instrumentSymbol: "GEMI-UCONN",
  side: "yes",
  gameStartTime: "2026-11-20T02:00:00Z",
  resolutionSide: null,
  resolvedAt: null,
  oddsAtTweet: null,
  ...over,
});

const post = (over: Partial<NewPost> = {}): NewPost => ({
  tweetId: "t1",
  xUserId: "u1",
  xHandle: "@Tipster",
  tweetedAt: "2026-11-19T12:03:00Z",
  tweetText: "UConn wins it",
  sentiment: { isPrediction: true },
  picks: [pick()],
  ...over,
});

/** In-memory stand-in for the database, recording what ingest asks it to do. */
function fakeStore(
  opts: { markets?: Record<string, MarketRow>; postOwnerConflict?: boolean; inserted?: boolean } = {},
) {
  const markets = opts.markets ?? { "NCAAM-UCONN-ARI-M": market() };
  const saved: CallInput[] = [];
  const users: { xUserId: string; handle: string }[] = [];
  const postIds = new Map<string, string>();
  const db: IngestDb = {
    upsertUser: async (xUserId, handle) => {
      users.push({ xUserId, handle });
      return `user-${xUserId}`;
    },
    upsertPost: async ({ tweetId }) => {
      if (opts.postOwnerConflict) return null;
      if (!postIds.has(tweetId)) postIds.set(tweetId, randomUUID());
      return postIds.get(tweetId)!;
    },
    findMarket: async (ticker) => markets[ticker] ?? null,
    upsertCall: async (input) => {
      saved.push(input);
      return { callId: randomUUID(), inserted: opts.inserted ?? true };
    },
  };
  const store: IngestStore = { transaction: (fn) => fn(db) };
  return { store, saved, users, postIds };
}

describe("priceFor", () => {
  const uconn = { label: "UConn", instrumentSymbol: "GEMI-UCONN", currentOdds: 0.62, noOdds: 0.4 };
  const tweeted = T("2026-11-19T12:03:00Z");

  it("uses a price supplied with the pick as history", () => {
    expect(priceFor(pick({ oddsAtTweet: 0.55 }), uconn, market(), tweeted)).toEqual({
      oddsAtCall: 0.55,
      oddsSource: "history",
    });
  });

  it("prices the picked side from a fresh sync of an open market", () => {
    expect(priceFor(pick({ side: "yes" }), uconn, market(), tweeted)).toEqual({ oddsAtCall: 0.62, oddsSource: "snapshot" });
    expect(priceFor(pick({ side: "no" }), uconn, market(), tweeted)).toEqual({ oddsAtCall: 0.4, oddsSource: "snapshot" });
  });

  it("derives the NO price from the YES price when noOdds is missing", () => {
    const old = { ...uconn, noOdds: undefined };
    expect(priceFor(pick({ side: "no" }), old, market(), tweeted).oddsAtCall).toBeCloseTo(0.38);
  });

  it(`accepts a sync up to ${MAX_PRICE_GAP_S} s from the tweet, before or after, and no more`, () => {
    const at = (offsetS: number) => new Date(SYNCED.getTime() + offsetS * 1000);
    expect(priceFor(pick(), uconn, market(), at(MAX_PRICE_GAP_S)).oddsSource).toBe("snapshot");
    expect(priceFor(pick(), uconn, market(), at(-MAX_PRICE_GAP_S)).oddsSource).toBe("snapshot");
    expect(priceFor(pick(), uconn, market(), at(MAX_PRICE_GAP_S + 1)).oddsSource).toBe("none");
    expect(priceFor(pick(), uconn, market(), at(-MAX_PRICE_GAP_S - 1)).oddsSource).toBe("none");
  });

  it("does not price from a market that is no longer open", () => {
    for (const status of ["locked", "resolved"] as const) {
      expect(priceFor(pick(), uconn, market({ status }), tweeted)).toEqual({ oddsAtCall: null, oddsSource: "none" });
    }
  });
});

describe("lagSeconds", () => {
  it("is the whole seconds since the tweet, never negative", () => {
    expect(lagSeconds(T("2026-11-19T12:00:00Z"), T("2026-11-19T12:05:00.400Z"))).toBe(300);
    expect(lagSeconds(T("2026-11-19T12:10:00Z"), T("2026-11-19T12:00:00Z"))).toBe(0);
  });
});

describe("ingestPost", () => {
  it("stores a priced call for each pick and strips the @ from the handle", async () => {
    const { store, saved, users } = fakeStore();
    const result = await ingestPost(
      store,
      post({ picks: [pick(), pick({ instrumentSymbol: "GEMI-ARI", side: "no" })] }),
      NOW,
    );

    expect(users).toEqual([{ xUserId: "u1", handle: "Tipster" }]);
    expect(result.picks.map((p) => [p.status, p.oddsSource])).toEqual([
      ["created", "snapshot"],
      ["created", "snapshot"],
    ]);
    expect(saved[0]).toMatchObject({ pickedOutcome: "UConn", side: "yes", oddsAtCall: 0.62, ingestLagS: 120 });
    expect(saved[1]).toMatchObject({ pickedOutcome: "Arizona", side: "no", oddsAtCall: 0.62, instrumentSymbol: "GEMI-ARI" });
  });

  it("skips picks it cannot place, with a reason, and still stores the others", async () => {
    const { store, saved } = fakeStore({
      markets: {
        "NCAAM-UCONN-ARI-M": market(),
        VOID: market({ status: "void" }),
        LOCKED: market({ lockTime: T("2026-11-19T12:03:00Z") }), // locks exactly at the tweet
      },
    });
    const result = await ingestPost(
      store,
      post({
        picks: [
          pick({ geminiEventTicker: "MISSING" }),
          pick({ geminiEventTicker: "VOID" }),
          pick({ instrumentSymbol: "GEMI-NOPE" }),
          pick({ geminiEventTicker: "LOCKED" }),
          pick(),
        ],
      }),
      NOW,
    );
    expect(result.picks.map((p) => p.reason ?? p.status)).toEqual([
      "no_market",
      "market_void",
      "unknown_contract",
      "after_lock",
      "created",
    ]);
    expect(saved).toHaveLength(1);
  });

  it("stores the call unpriced when the market was synced long before the tweet", async () => {
    const { store, saved } = fakeStore();
    const result = await ingestPost(store, post({ tweetedAt: "2026-11-19T13:00:00Z" }), T("2026-11-19T13:01:00Z"));
    expect(result.picks[0]).toMatchObject({ status: "created", oddsSource: "none" });
    expect(saved[0]).toMatchObject({ oddsAtCall: null, oddsSource: "none" });
  });

  it("reports a tweet id that belongs to another user and stores no calls", async () => {
    const { store, saved } = fakeStore({ postOwnerConflict: true });
    const result = await ingestPost(store, post(), NOW);
    expect(result).toEqual({ tweetId: "t1", postId: null, picks: [], error: "tweet id belongs to another user" });
    expect(saved).toHaveLength(0);
  });
});

describe("ingestPosts", () => {
  it("processes oldest tweets first but returns results in the order sent", async () => {
    const { store, saved, postIds } = fakeStore();
    const results = await ingestPosts(
      store,
      [
        post({ tweetId: "late", tweetedAt: "2026-11-19T12:04:00Z" }),
        post({ tweetId: "early", tweetedAt: "2026-11-19T12:01:00Z" }),
      ],
      NOW,
    );
    expect(results.map((r) => r.tweetId)).toEqual(["late", "early"]);
    expect(saved.map((c) => c.postId)).toEqual([postIds.get("early"), postIds.get("late")]);
  });

  it("isolates a post that throws", async () => {
    const failing: IngestStore = {
      transaction: (fn) => {
        throw new Error("db down");
      },
    };
    const onError = vi.fn();
    const results = await ingestPosts(failing, [post()], NOW, onError);
    expect(results).toEqual([{ tweetId: "t1", postId: null, picks: [], error: "could not store post" }]);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("POST /v1/posts", () => {
  const KEY = "secret-key";
  const build = (
    opts: {
      serviceKey?: string | null;
      ingest?: IngestStore | null;
      notify?: (callId: string) => Promise<void>;
    } = {},
  ) => {
    const { store } = fakeStore();
    return createApp({
      store: { findByHandles: async () => [], leaderboard: async () => [] },
      ingest: opts.ingest === null ? undefined : (opts.ingest ?? store),
      serviceKey: opts.serviceKey === null ? undefined : (opts.serviceKey ?? KEY),
      notifyNewCall: opts.notify,
      now: () => NOW.getTime(),
    });
  };
  const send = (app: ReturnType<typeof build>, body: unknown, key: string | null = KEY) =>
    app.request("/v1/posts", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key === null ? {} : { "x-service-key": key }) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("is switched off until a key and a store are configured", async () => {
    expect((await send(build({ serviceKey: null }), post())).status).toBe(503);
    expect((await send(build({ ingest: null }), post())).status).toBe(503);
  });

  it("rejects a missing or wrong service key", async () => {
    expect((await send(build(), post(), null)).status).toBe(401);
    expect((await send(build(), post(), "wrong")).status).toBe(401);
    expect((await send(build(), post(), KEY + "x")).status).toBe(401);
  });

  it("accepts one post or a batch and answers 201 with a result per post", async () => {
    const one = await send(build(), post());
    expect(one.status).toBe(201);
    const body = IngestResponse.parse(await one.json());
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.picks[0]).toMatchObject({ index: 0, status: "created", oddsSource: "snapshot" });

    const batch = await send(build(), [post({ tweetId: "a" }), post({ tweetId: "b" })]);
    expect(batch.status).toBe(201);
    expect((await batch.json()).results.map((r: { tweetId: string }) => r.tweetId)).toEqual(["a", "b"]);
  });

  it("stores a post with no picks", async () => {
    const res = await send(build(), post({ picks: [] }));
    expect(res.status).toBe(201);
    expect((await res.json()).results[0].picks).toEqual([]);
  });

  it("rejects bad JSON and bad shapes with a 400 that names the problem", async () => {
    expect((await send(build(), "{nope")).status).toBe(400);
    const bad = await send(build(), post({ tweetedAt: "yesterday", xHandle: "not a handle" }));
    expect(bad.status).toBe(400);
    const { issues } = await bad.json();
    expect(issues.join(" ")).toContain("tweetedAt");
    expect(issues.join(" ")).toContain("xHandle");
    expect((await send(build(), [])).status).toBe(400);
    expect((await send(build(), { tweetId: "x" })).status).toBe(400);
    expect((await send(build(), post({ picks: [pick({ side: "maybe" as never })] }))).status).toBe(400);
    expect((await send(build(), post({ picks: [pick({ oddsAtTweet: 1.5 })] }))).status).toBe(400);
  });

  it(`limits a batch to ${MAX_POSTS_PER_REQUEST} posts`, async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => post({ tweetId: `t${i}` }));
    expect((await send(build(), many(MAX_POSTS_PER_REQUEST))).status).toBe(201);
    expect((await send(build(), many(MAX_POSTS_PER_REQUEST + 1))).status).toBe(400);
  });
});

describe("telling the trading service about new picks", () => {
  const KEY = "k";
  const send = (app: ReturnType<typeof createApp>, body: unknown) =>
    app.request("/v1/posts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-key": KEY },
      body: JSON.stringify(body),
    });
  const appWith = (notify: (id: string) => Promise<void>, store: IngestStore) =>
    createApp({
      store: { findByHandles: async () => [], leaderboard: async () => [] },
      ingest: store,
      serviceKey: KEY,
      notifyNewCall: notify,
      now: () => NOW.getTime(),
    });

  it("notifies once for each newly created call on a fresh tweet", async () => {
    const notify = vi.fn(async (_id: string) => {});
    const { store } = fakeStore();
    const res = await send(
      appWith(notify, store),
      post({ picks: [pick(), pick({ instrumentSymbol: "GEMI-ARI", side: "no" })] }), // tweeted 2 min ago
    );
    const ids = (await res.json()).results[0].picks.map((p: { callId: string }) => p.callId);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
    expect(notify.mock.calls.map((c) => c[0]).sort()).toEqual([...ids].sort());
  });

  it("never notifies for an old tweet, even though its call is created", async () => {
    const notify = vi.fn(async (_id: string) => {});
    const { store } = fakeStore();
    const res = await send(appWith(notify, store), post({ tweetedAt: "2026-11-16T12:00:00Z" }));
    expect((await res.json()).results[0].picks[0].status).toBe("created");
    await new Promise((r) => setTimeout(r, 20));
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify on the edge: just past the freshness limit", async () => {
    const notify = vi.fn(async (_id: string) => {});
    const { store } = fakeStore();
    const stale = new Date(NOW.getTime() - (MAX_COPY_PICK_AGE_S + 1) * 1000).toISOString();
    const fresh = new Date(NOW.getTime() - MAX_COPY_PICK_AGE_S * 1000).toISOString();
    await send(appWith(notify, store), [
      post({ tweetId: "stale", tweetedAt: stale, picks: [pick({ geminiEventTicker: "NCAAM-UCONN-ARI-M" })] }),
      post({ tweetId: "fresh", tweetedAt: fresh, picks: [pick({ geminiEventTicker: "NCAAM-UCONN-ARI-M" })] }),
    ]);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does not notify for a re-sent or replaced pick, or one that was skipped", async () => {
    const notify = vi.fn(async (_id: string) => {});
    const updated = fakeStore({ inserted: false }).store; // the call already existed
    await send(appWith(notify, updated), post());
    const skipped = fakeStore({ markets: {} }).store; // no such market
    await send(appWith(notify, skipped), post());
    await new Promise((r) => setTimeout(r, 20));
    expect(notify).not.toHaveBeenCalled();
  });

  it("still answers 201 and reports the calls when the trading service is down", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const notify = vi.fn(async (_id: string) => {
      throw new Error("connection refused");
    });
    const { store } = fakeStore();
    const res = await send(appWith(notify, store), post());
    expect(res.status).toBe(201);
    expect((await res.json()).results[0].picks[0].status).toBe("created");
    await vi.waitFor(() => expect(errors).toHaveBeenCalled());
    errors.mockRestore();
  });
});
