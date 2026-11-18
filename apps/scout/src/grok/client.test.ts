import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGrok, GrokOutputError } from "./client.js";

const schema = z.object({ n: z.number() });
const chat = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
const asFetch = (f: unknown) => f as typeof fetch;
const args = { name: "thing", schema, system: "SYS", user: "USR" };

describe("createGrok", () => {
  it("sends model, messages and a json_schema response_format", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => chat('{"n":1}'));
    const grok = createGrok({ apiKey: "k", model: "m", fetch: asFetch(f) });
    await grok.json(args);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer k");
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("m");
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "USR" },
    ]);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("thing");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.n.type).toBe("number");
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
  });

  it("returns parsed valid content", async () => {
    const f = vi.fn(async () => chat('{"n":7}'));
    const grok = createGrok({ apiKey: "k", model: "m", fetch: asFetch(f) });
    expect(await grok.json(args)).toEqual({ n: 7 });
  });

  it("retries once after invalid output", async () => {
    const f = vi.fn().mockResolvedValueOnce(chat("not json")).mockResolvedValueOnce(chat('{"n":2}'));
    const grok = createGrok({ apiKey: "k", model: "m", fetch: asFetch(f) });
    expect(await grok.json(args)).toEqual({ n: 2 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("throws GrokOutputError after two invalid responses", async () => {
    const f = vi.fn(async () => chat('{"n":"x"}'));
    const grok = createGrok({ apiKey: "k", model: "m", fetch: asFetch(f) });
    await expect(grok.json(args)).rejects.toBeInstanceOf(GrokOutputError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("sends a 60s timeout signal with each request", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const f = vi.fn(async (_url: string, _init?: RequestInit) => chat('{"n":1}'));
    const grok = createGrok({ apiKey: "k", model: "m", fetch: asFetch(f) });
    await grok.json(args);
    expect(timeout).toHaveBeenCalledWith(60_000);
    expect(f.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it("retries once after a network error, then returns the value", async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(chat('{"n":3}'));
    const grok = createGrok({ apiKey: "k", model: "m", fetch: asFetch(f) });
    expect(await grok.json(args)).toEqual({ n: 3 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("throws GrokOutputError after two rejected fetches, naming the error but not the key", async () => {
    const abort = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const f = vi.fn(async () => Promise.reject(abort));
    const grok = createGrok({ apiKey: "secret-key", model: "m", fetch: asFetch(f) });
    const err = await grok.json(args).catch((e) => e);
    expect(err).toBeInstanceOf(GrokOutputError);
    expect(err.message).toContain("TimeoutError");
    expect(err.message).not.toContain("secret-key");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("treats non-2xx as an error, retries once, and never leaks the key", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 500 }));
    const grok = createGrok({ apiKey: "secret-key", model: "m", fetch: asFetch(f) });
    const err = await grok.json(args).catch((e) => e);
    expect(err).toBeInstanceOf(GrokOutputError);
    expect(err.message).toContain("500");
    expect(err.message).not.toContain("secret-key");
    expect(f).toHaveBeenCalledTimes(2);
  });
});
