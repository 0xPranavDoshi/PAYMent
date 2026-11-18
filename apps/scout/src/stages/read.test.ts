import { describe, expect, it, vi } from "vitest";
import { GrokOutputError, type Grok } from "../grok/client.js";
import type { RawPost } from "../posts/source.js";
import { READ_BATCH_SIZE, READ_SYSTEM_PROMPT, readPosts } from "./read.js";

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
  it("batches 45 posts into 20/20/5 and returns an entry per tweet", async () => {
    expect(READ_BATCH_SIZE).toBe(20);
    const grok = echoGrok();
    const out = await readPosts(posts(45), grok, "model-x");
    expect(grok.json).toHaveBeenCalledTimes(3);
    const sizes = grok.json.mock.calls.map(([a]) => new Set(a.user.match(/id\d+/g)).size);
    expect(sizes).toEqual([20, 20, 5]);
    expect(out.size).toBe(45);
    expect(out.get("id3")?.model).toBe("model-x");
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

  it("maps a failed batch to null while other batches succeed", async () => {
    const ok = echoGrok();
    let call = 0;
    const grok = {
      json: vi.fn(async (a: { user: string }) => {
        if (call++ === 1) throw new GrokOutputError("bad");
        return ok.json(a as never);
      }),
    } as unknown as Grok;
    const out = await readPosts(posts(45), grok, "m");
    expect(out.get("id0")).not.toBeNull();
    expect(out.get("id20")).toBeNull();
    expect(out.get("id39")).toBeNull();
    expect(out.get("id40")).not.toBeNull();
  });

  it("defines spread lines as positive sizes with covers/loses direction", () => {
    expect(READ_SYSTEM_PROMPT).toContain("positive size of the spread");
    expect(READ_SYSTEM_PROMPT).toMatch(/"X \+L".*claim "loses", line L/);
    expect(READ_SYSTEM_PROMPT).toMatch(/"X -L".*claim "covers", line L/);
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
