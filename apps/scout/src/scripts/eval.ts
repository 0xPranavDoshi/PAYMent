import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { countsAsPrediction, type PickMatch, type Sentiment } from "@copayme/shared";
import { createGeminiClient, type GeminiClient } from "../gemini/client.js";
import { createGrok, type Grok } from "../grok/client.js";
import { matchPrediction } from "../match/match.js";
import type { RawPost } from "../posts/source.js";
import { readPosts } from "../stages/read.js";

export interface LabelledPost {
  tweetId: string;
  tweetedAt: string;
  text: string;
  /** Empty means the post is not a prediction. */
  expected: { instrumentSymbol: string; side: "yes" | "no" }[];
}

export type BetType = "win" | "spread" | "total" | "prop";
const BET_TYPES: BetType[] = ["win", "spread", "total", "prop"];

export interface EvalReport {
  byBetType: Record<string, { correct: number; total: number }>;
  falsePositives: number;
  misses: string[];
}

/** Bet type from a Gemini sub-event ticker suffix: -M win, -S/-1HS spread, -T/-1HT total, else prop. */
const betTypeOfTicker = (ticker: string): BetType =>
  ticker.endsWith("-M")
    ? "win"
    : ticker.endsWith("-S") || ticker.endsWith("-1HS")
      ? "spread"
      : ticker.endsWith("-T") || ticker.endsWith("-1HT")
        ? "total"
        : "prop";

/** GEMI-<event ticker>-<contract> -> <event ticker>. */
const eventTickerOf = (instrumentSymbol: string): string => {
  const bare = instrumentSymbol.replace(/^GEMI-/, "");
  return bare.slice(0, bare.lastIndexOf("-"));
};

export function scoreEval(labelled: LabelledPost[], got: Map<string, PickMatch[]>): EvalReport {
  const byBetType: Record<string, { correct: number; total: number }> = {};
  const misses: string[] = [];
  let falsePositives = 0;

  for (const post of labelled) {
    const matched = (got.get(post.tweetId) ?? []).filter((m) => m.status === "matched");
    if (post.expected.length === 0) {
      falsePositives += matched.length;
      continue;
    }
    let missed = false;
    for (const exp of post.expected) {
      const hit = matched.find((m) => m.instrumentSymbol === exp.instrumentSymbol && m.side === exp.side);
      const ticker = hit?.geminiEventTicker ?? eventTickerOf(exp.instrumentSymbol);
      const slot = (byBetType[betTypeOfTicker(ticker)] ??= { correct: 0, total: 0 });
      slot.total += 1;
      if (hit) slot.correct += 1;
      else missed = true;
    }
    if (missed) misses.push(post.tweetId);
  }

  return { byBetType, falsePositives, misses };
}

const LABELLED_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../eval/labelled.json");

async function matchPost(
  post: LabelledPost,
  sentiment: Sentiment | null,
  deps: { gemini: GeminiClient; grok: Grok },
): Promise<PickMatch[]> {
  if (sentiment === null || !countsAsPrediction(sentiment)) return [];
  try {
    const out: PickMatch[] = [];
    for (const [i, p] of sentiment.predictions.entries()) {
      out.push(await matchPrediction(p, i, new Date(post.tweetedAt), deps));
    }
    return out;
  } catch (e) {
    console.error(`[eval] matching failed for ${post.tweetId}, counting as no picks: ${(e as Error).message}`);
    return [];
  }
}

async function main(): Promise<void> {
  const labelled = JSON.parse(readFileSync(LABELLED_PATH, "utf8")) as LabelledPost[];
  if (labelled.length === 0) {
    console.log("No labelled posts — add some to eval/labelled.json");
    return;
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.error("Missing required env: XAI_API_KEY (see .env.example).");
    process.exitCode = 1;
    return;
  }
  const model = process.env.XAI_MODEL || "grok-4-1-fast-reasoning";
  const grok = createGrok({ apiKey, model });
  const gemini = createGeminiClient();

  const raws: RawPost[] = labelled.map((p) => ({
    tweetId: p.tweetId,
    xUserId: "eval",
    xHandle: "eval",
    text: p.text,
    createdAt: p.tweetedAt,
    isRetweet: false,
    isReply: false,
  }));
  const sentiments = await readPosts(raws, grok, model);

  const got = new Map<string, PickMatch[]>();
  for (const post of labelled) {
    got.set(post.tweetId, await matchPost(post, sentiments.get(post.tweetId) ?? null, { gemini, grok }));
  }

  const report = scoreEval(labelled, got);
  const rows = BET_TYPES.map((t) => {
    const { correct, total } = report.byBetType[t] ?? { correct: 0, total: 0 };
    return {
      "bet type": t,
      correct,
      total,
      percent: total === 0 ? "n/a" : `${((correct / total) * 100).toFixed(1)}%`,
    };
  });
  console.table(rows);
  console.log(`False positives: ${report.falsePositives}`);
  console.log(`Misses (${report.misses.length}): ${report.misses.join(", ") || "none"}`);

  const win = report.byBetType.win;
  if (win && win.total > 0 && win.correct / win.total < 0.8) {
    console.log("win accuracy is below 80%");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
