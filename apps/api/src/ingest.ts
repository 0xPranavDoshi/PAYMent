import type { NewPost, Pick, PickOutcome, PostResult } from "@copayme/shared";
import { z } from "zod";

/**
 * A pick is priced from the markets table only if that row was synced within this many
 * seconds of the tweet, so the stored price is close to the price at tweet time.
 */
export const MAX_PRICE_GAP_S = 600;

export type MarketStatus = "open" | "locked" | "resolved" | "void";

export interface MarketRow {
  id: string;
  lockTime: Date;
  status: MarketStatus;
  /** markets.outcomes as stored (jsonb). */
  outcomes: unknown;
  /** When the sync last wrote this row. */
  syncedAt: Date;
}

export interface CallInput {
  postId: string;
  userId: string;
  marketId: string;
  pickedOutcome: string;
  instrumentSymbol: string;
  side: "yes" | "no";
  tweetedAt: Date;
  oddsAtCall: number | null;
  oddsSource: "history" | "snapshot" | "none";
  ingestLagS: number;
}

/** Everything ingest needs from the database. One instance lives for one transaction. */
export interface IngestDb {
  upsertUser(xUserId: string, handle: string): Promise<string>;
  /** Returns null when the tweet id already belongs to a different user. */
  upsertPost(input: {
    tweetId: string;
    userId: string;
    tweetedAt: Date;
    tweetText: string;
    sentiment: unknown;
  }): Promise<string | null>;
  findMarket(ticker: string): Promise<MarketRow | null>;
  /**
   * Inserts the call, or replaces the user's existing pending call on this market when this
   * one is from the same post or an earlier tweet. Returns null when the existing call stays.
   */
  upsertCall(input: CallInput): Promise<{ callId: string; inserted: boolean } | null>;
}

export interface IngestStore {
  /** Runs fn in one transaction. */
  transaction<T>(fn: (db: IngestDb) => Promise<T>): Promise<T>;
}

/** Lenient on purpose: rows written before noOdds existed still have to work. */
const StoredContract = z.object({
  label: z.string(),
  instrumentSymbol: z.string(),
  currentOdds: z.number().min(0).max(1),
  noOdds: z.number().min(0).max(1).nullish(),
});
type StoredContract = z.infer<typeof StoredContract>;

function contracts(outcomes: unknown): StoredContract[] {
  const parsed = z.array(StoredContract).safeParse(outcomes);
  return parsed.success ? parsed.data : [];
}

export interface Pricing {
  oddsAtCall: number | null;
  oddsSource: "history" | "snapshot" | "none";
}

/**
 * The price of the picked side when the user tweeted, and where it came from.
 * - history: the scout supplied it.
 * - snapshot: the market is open and was synced within MAX_PRICE_GAP_S of the tweet.
 * - none: anything else. The call is stored but does not count toward the score.
 */
export function priceFor(
  pick: Pick,
  contract: StoredContract,
  market: MarketRow,
  tweetedAt: Date,
): Pricing {
  if (pick.oddsAtTweet !== null) return { oddsAtCall: pick.oddsAtTweet, oddsSource: "history" };

  const gapS = Math.abs(market.syncedAt.getTime() - tweetedAt.getTime()) / 1000;
  if (market.status === "open" && gapS <= MAX_PRICE_GAP_S) {
    const price = pick.side === "yes" ? contract.currentOdds : (contract.noOdds ?? 1 - contract.currentOdds);
    return { oddsAtCall: price, oddsSource: "snapshot" };
  }
  return { oddsAtCall: null, oddsSource: "none" };
}

export function lagSeconds(tweetedAt: Date, now: Date): number {
  const s = Math.round((now.getTime() - tweetedAt.getTime()) / 1000);
  return Math.min(Math.max(s, 0), 2_147_483_647);
}

/** Stores one post and creates or updates a call for each of its picks. Atomic per post. */
export async function ingestPost(store: IngestStore, post: NewPost, now: Date): Promise<PostResult> {
  const tweetedAt = new Date(post.tweetedAt);
  const handle = post.xHandle.replace(/^@/, "");

  return store.transaction(async (db) => {
    const userId = await db.upsertUser(post.xUserId, handle);
    const postId = await db.upsertPost({
      tweetId: post.tweetId,
      userId,
      tweetedAt,
      tweetText: post.tweetText,
      sentiment: post.sentiment,
    });
    if (postId === null) {
      return { tweetId: post.tweetId, postId: null, picks: [], error: "tweet id belongs to another user" };
    }

    const markets = new Map<string, MarketRow | null>();
    const picks: PickOutcome[] = [];

    for (const [index, pick] of post.picks.entries()) {
      const skip = (reason: NonNullable<PickOutcome["reason"]>): PickOutcome => ({
        index,
        status: "skipped",
        reason,
      });

      if (!markets.has(pick.geminiEventTicker)) {
        markets.set(pick.geminiEventTicker, await db.findMarket(pick.geminiEventTicker));
      }
      const market = markets.get(pick.geminiEventTicker);
      if (!market) {
        picks.push(skip("no_market"));
        continue;
      }
      if (market.status === "void") {
        picks.push(skip("market_void"));
        continue;
      }
      const contract = contracts(market.outcomes).find((c) => c.instrumentSymbol === pick.instrumentSymbol);
      if (!contract) {
        picks.push(skip("unknown_contract"));
        continue;
      }
      if (tweetedAt.getTime() >= market.lockTime.getTime()) {
        picks.push(skip("after_lock"));
        continue;
      }

      const pricing = priceFor(pick, contract, market, tweetedAt);
      const saved = await db.upsertCall({
        postId,
        userId,
        marketId: market.id,
        pickedOutcome: contract.label,
        instrumentSymbol: pick.instrumentSymbol,
        side: pick.side,
        tweetedAt,
        oddsAtCall: pricing.oddsAtCall,
        oddsSource: pricing.oddsSource,
        ingestLagS: lagSeconds(tweetedAt, now),
      });
      picks.push(
        saved
          ? {
              index,
              status: saved.inserted ? "created" : "updated",
              callId: saved.callId,
              oddsSource: pricing.oddsSource,
            }
          : skip("duplicate_pick"),
      );
    }

    return { tweetId: post.tweetId, postId, picks };
  });
}

/**
 * Ingests a batch. Posts are processed oldest tweet first so "the earliest tweet wins" does
 * not depend on the order the scout sent them in, and results come back in the input order.
 * A post that fails is reported with an error; the others still go through.
 */
export async function ingestPosts(
  store: IngestStore,
  posts: readonly NewPost[],
  now: Date,
  onError: (err: unknown, post: NewPost) => void = () => {},
): Promise<PostResult[]> {
  const order = posts
    .map((post, i) => ({ post, i }))
    .sort((a, b) => Date.parse(a.post.tweetedAt) - Date.parse(b.post.tweetedAt));

  const results: PostResult[] = new Array(posts.length);
  for (const { post, i } of order) {
    try {
      results[i] = await ingestPost(store, post, now);
    } catch (err) {
      onError(err, post);
      results[i] = { tweetId: post.tweetId, postId: null, picks: [], error: "could not store post" };
    }
  }
  return results;
}
