import { describe, expect, it, vi } from "vitest";
import { createGrok, GrokOutputError, type Grok } from "../grok/client.js";
import type { RawPost } from "../posts/source.js";
import { READ_BATCH_SIZE, READ_CONCURRENCY, READ_SYSTEM_PROMPT, readPosts } from "./read.js";

const post = (i: number, extra: Partial<RawPost> = {}): RawPost => ({
  tweetId: `id${i}`,
  xUserId: "u",
  xHandle: "h",
  text: `text number ${i}`,
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
  isRetweet: false,
  isReply: false,
  ...extra,
});
const posts = (n: number) => Array.from({ length: n }, (_, i) => post(i));
const verdict = (tweetId: string) => ({
  tweetId,
  sentiment: { isPrediction: false, confidence: 0.1, predictions: [] },
});
const echoGrok = () =>
  ({
    json: vi.fn(async ({ user }: { user: string }) => ({
      results: [...user.matchAll(/id\d+/g)].map((m) => verdict(m[0])),
    })),
  }) as unknown as Grok & { json: ReturnType<typeof vi.fn> };

describe("readPosts", () => {
  it("batches 12 posts into 5/5/2 and returns an entry per tweet", async () => {
    expect(READ_BATCH_SIZE).toBe(5);
    const grok = echoGrok();
    const out = await readPosts(posts(12), grok, "model-x");
    expect(grok.json).toHaveBeenCalledTimes(3);
    const sizes = grok.json.mock.calls.map(([a]) => new Set(a.user.match(/id\d+/g)).size).sort();
    expect(sizes).toEqual([2, 5, 5]);
    expect(out.size).toBe(12);
    expect(out.get("id3")?.model).toBe("model-x");
  });

  it("keeps at most READ_CONCURRENCY batches in flight", async () => {
    expect(READ_CONCURRENCY).toBe(12);
    let inFlight = 0;
    let peak = 0;
    const grok = {
      json: vi.fn(async ({ user }: { user: string }) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { results: [...user.matchAll(/id\d+/g)].map((m) => verdict(m[0])) };
      }),
    } as unknown as Grok;
    const out = await readPosts(posts(90), grok, "m");
    expect(peak).toBe(12);
    expect(grok.json).toHaveBeenCalledTimes(18);
    expect([...out.values()].every((s) => s !== null)).toBe(true);
  });

  it("includes id, ISO time, text and quotedText in the user message", async () => {
    const grok = echoGrok();
    const p = post(1, { quotedText: "quoted words here" });
    await readPosts([p, post(2)], grok, "m");
    const user: string = grok.json.mock.calls[0]![0].user;
    for (const s of [p.tweetId, p.createdAt, p.text, "quoted words here", "id2", "text number 2"]) {
      expect(user).toContain(s);
    }
  });

  it("maps a failed batch to null while other batches succeed, and logs the failure", async () => {
    const ok = echoGrok();
    const grok = {
      json: vi.fn(async (a: { user: string }) => {
        if (/"id5"/.test(a.user)) throw new GrokOutputError("Grok returned HTTP 429");
        return ok.json(a as never);
      }),
    } as unknown as Grok;
    const logs: string[] = [];
    const out = await readPosts(posts(12), grok, "m", (m) => logs.push(m));
    expect(out.get("id0")).not.toBeNull();
    expect(out.get("id5")).toBeNull();
    expect(out.get("id9")).toBeNull();
    expect(out.get("id10")).not.toBeNull();
    expect(logs).toEqual(["[scout] Grok batch of 5 posts failed, will retry next scan: Grok returned HTTP 429"]);
  });

  it("anchors 'not happened yet' to each post's createdAt in the system prompt sent to Grok", async () => {
    const grok = echoGrok();
    await readPosts([post(1)], grok, "m");
    const system: string = grok.json.mock.calls[0]![0].system;
    expect(system).toContain("createdAt");
    const rule1 = system.split("\n").find((l) => l.startsWith("1."));
    expect(rule1).toMatch(/as of the post's createdAt/);
    expect(rule1).toMatch(/even if the game has since been played/);
  });

  it("maps a batch whose fetch rejects to null while other batches return values", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const user = JSON.parse(init!.body as string).messages[1].content as string;
      // the batch holding id5..id9 hits a network error on its first try and its retry
      if (/"id5"/.test(user)) throw new TypeError("fetch failed");
      const content = JSON.stringify({ results: [...user.matchAll(/id\d+/g)].map((m) => verdict(m[0])) });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    });
    const grok = createGrok({ apiKey: "k", model: "m", fetch: fetchFn as unknown as typeof fetch });
    const out = await readPosts(posts(12), grok, "m");
    expect(fetchFn).toHaveBeenCalledTimes(4); // 2 good batches + 2 attempts for the failing one
    expect(out.get("id0")).not.toBeNull();
    expect(out.get("id5")).toBeNull();
    expect(out.get("id9")).toBeNull();
    expect(out.get("id10")).not.toBeNull();
  });

  it("asks for the line verbatim and separates team totals from game totals", () => {
    expect(READ_SYSTEM_PROMPT).toContain(`lineAsWritten: copy the line EXACTLY`);
    expect(READ_SYSTEM_PROMPT).toContain(`"UCONN +3.5" -> "+3.5"`);
    expect(READ_SYSTEM_PROMPT).toMatch(/"Hawaii Team Total u17.5".*is "team_total", never "total"/);
  });

  it("defines spread lines as positive sizes, with the sign deciding direction", () => {
    expect(READ_SYSTEM_PROMPT).toContain("positive size of the spread");
    expect(READ_SYSTEM_PROMPT).toContain("The SIGN decides, not the wording");
    expect(READ_SYSTEM_PROMPT).toMatch(/"\+" in front of the number.*claim "loses", line L/);
    expect(READ_SYSTEM_PROMPT).toMatch(/"-" in front of the number.*claim "covers", line L/);
    // The real tweet that fooled the old prompt: "cover" with a plus sign is an underdog pick.
    expect(READ_SYSTEM_PROMPT).toContain(
      `"I favor backing Tennessee to cover +3.5" -> team Tennessee, claim "loses", line 3.5`,
    );
  });

  it("maps a tweet missing from the response to null", async () => {
    const grok = {
      json: vi.fn(async () => ({ results: [verdict("id0")] })),
    } as unknown as Grok;
    const out = await readPosts(posts(2), grok, "m");
    expect(out.get("id0")).not.toBeNull();
    expect(out.get("id1")).toBeNull();
  });
});
