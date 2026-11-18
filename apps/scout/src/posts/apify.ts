import { tweetIdToDate } from "../time.js";
import { PostSourceError, type PostSource, type RawPost } from "./source.js";

const DEFAULT_ACTOR_ID = "kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest";
const ACTOR_MIN_ITEMS = 20;
const MAX_CLOCK_SKEW_MS = 60_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** Map one actor dataset item to a RawPost, or null if it is not a usable tweet. */
export function normalizeApifyItem(item: unknown): RawPost | null {
  if (!isRecord(item) || item.type !== "tweet") return null;
  const id = str(item.id);
  const text = typeof item.text === "string" ? item.text : undefined;
  const author = isRecord(item.author) ? item.author : undefined;
  const userName = str(author?.userName);
  const userId = str(author?.id);
  if (!id || text === undefined || !userName || !userId || !/^\d+$/.test(id)) return null;

  const createdAt = tweetIdToDate(id);
  const provider = typeof item.createdAt === "string" ? Date.parse(item.createdAt) : NaN;
  if (Number.isFinite(provider) && Math.abs(provider - createdAt.getTime()) > MAX_CLOCK_SKEW_MS) {
    console.warn(`[scout] tweet ${id}: id time differs from provider createdAt by >60s`);
  }

  const quoted = isRecord(item.quoted_tweet) ? str(item.quoted_tweet.text) : undefined;
  const post: RawPost = {
    tweetId: id,
    xUserId: userId,
    xHandle: userName.toLowerCase(),
    text,
    createdAt: createdAt.toISOString(),
    isRetweet: item.isRetweet === true,
    isReply: item.isReply === true,
  };
  if (quoted) post.quotedText = quoted;
  return post;
}

export function createApifySource(opts: {
  token: string;
  actorId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): PostSource {
  const doFetch = opts.fetch ?? fetch;
  const actorId = opts.actorId || DEFAULT_ACTOR_ID;
  const timeoutMs = opts.timeoutMs ?? 90_000;

  return {
    async fetchPosts(handle, { sinceId, limit }) {
      const clean = handle.replace(/^@/, "").toLowerCase();
      const url =
        `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}` +
        `/run-sync-get-dataset-items?token=${encodeURIComponent(opts.token)}`;

      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            searchTerms: [`from:${clean}`],
            queryType: "Latest",
            maxItems: Math.max(limit, ACTOR_MIN_ITEMS),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new PostSourceError(`Apify request failed: ${String(cause)}`, { cause });
      }
      if (!res.ok) throw new PostSourceError(`Apify responded with HTTP ${res.status}`);

      let body: unknown;
      try {
        body = await res.json();
      } catch (cause) {
        throw new PostSourceError("Apify returned invalid JSON", { cause });
      }
      if (!Array.isArray(body)) throw new PostSourceError("Apify returned a non-array body");

      const posts: RawPost[] = [];
      for (const item of body) {
        const post = normalizeApifyItem(item);
        if (!post) continue;
        if (sinceId !== undefined && BigInt(post.tweetId) <= BigInt(sinceId)) continue;
        posts.push(post);
      }
      return posts;
    },
  };
}
