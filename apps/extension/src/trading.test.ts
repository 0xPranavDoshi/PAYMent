import { describe, expect, it, vi } from "vitest";
import { SIGNED_OUT, createMockTrading, createTradingService, validFollowerId } from "./trading.js";
import { createTradingBridge } from "./tradingBridge.js";
import type { TradingReply, TradingRequest } from "./messages.js";

const FOLLOWER = "11111111-1111-4111-8111-111111111111";
const watchItem = (handle: string) => ({ traderHandle: handle, watchedAt: "2026-11-19T12:00:00.000Z", nPicks: 0, paperPnlUsdc: null, activePicks: 0 });
const copyItem = (handle: string, active: boolean, amountUsdc = 10) => ({ traderHandle: handle, amountUsdc, active, createdAt: "2026-11-19T12:00:00.000Z", nTrades: 0, livePnlUsdc: null });

function service(responses: Record<string, unknown>, followerId: string | null = FOLLOWER, scoreAt?: (handle: string, at: string) => Promise<number | null>) {
  const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    if (!(key in responses)) return new Response(JSON.stringify({ error: `unexpected ${key}` }), { status: 404 });
    const body = responses[key];
    return body instanceof Response ? body : new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const actions = createTradingService({ baseUrl: "http://trading:8788", getFollowerId: async () => followerId, scoreAt, fetcher });
  return { actions, fetcher };
}

describe("validFollowerId", () => {
  it("accepts only real ids", () => {
    expect(validFollowerId(FOLLOWER)).toBe(FOLLOWER);
    for (const bad of ["", "abc", 5, null, undefined, "11111111-1111-4111-8111-11111111111"]) expect(validFollowerId(bad)).toBeNull();
  });
});

describe("createTradingService", () => {
  it("is signed out, and never makes a request, when there is no user", async () => {
    const { actions, fetcher } = service({}, null);
    expect(await actions.state("alice")).toEqual(SIGNED_OUT);
    await expect(actions.setWatch("alice", true)).rejects.toThrow("Not signed in");
    await expect(actions.startCopy("alice", 10)).rejects.toThrow("Not signed in");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads whether this trader is watched or copied, ignoring other traders and handle case", async () => {
    const { actions, fetcher } = service({
      "GET /v1/watches": [watchItem("other"), { ...watchItem("Alice"), nPicks: 9, activePicks: 2, paperPnlUsdc: 0.42 }],
      "GET /v1/copy-trades": [copyItem("other", true), copyItem("alice", true, 25)],
      "GET /v1/config": { copyTradeMode: "paper" },
    }, FOLLOWER, async () => 68);
    expect(await actions.state("ALICE")).toEqual({
      signedIn: true,
      watch: { since: "2026-11-19T12:00:00.000Z", picks: 9, openPicks: 2, paperPnlUsdc: 0.42, scoreThen: 68 },
      copy: { active: true, amountUsdc: 25 },
      copyMode: "paper",
    });
    const watchesCall = fetcher.mock.calls.find(([url]) => String(url).endsWith("/v1/watches"))!;
    expect((watchesCall[1]!.headers as Record<string, string>)["x-follower-id"]).toBe(FOLLOWER);
  });

  it("asks for the trader's score as of when the watch started", async () => {
    const scoreAt = vi.fn(async (_handle: string, _at: string) => 61);
    const { actions } = service({ "GET /v1/watches": [watchItem("alice")], "GET /v1/copy-trades": [], "GET /v1/config": { copyTradeMode: "paper" } }, FOLLOWER, scoreAt);
    await actions.state("alice");
    expect(scoreAt).toHaveBeenCalledWith("alice", "2026-11-19T12:00:00.000Z");
  });

  it("still returns the watch when the score history is unavailable, with no score for then", async () => {
    const { actions } = service({ "GET /v1/watches": [watchItem("alice")], "GET /v1/copy-trades": [], "GET /v1/config": { copyTradeMode: "paper" } }, FOLLOWER, async () => {
      throw new Error("history down");
    });
    expect((await actions.state("alice")).watch).toMatchObject({ scoreThen: null });
  });

  it("is not watching or copying when the trader is in neither list", async () => {
    const { actions } = service({ "GET /v1/watches": [], "GET /v1/copy-trades": [], "GET /v1/config": { copyTradeMode: "live" } });
    expect(await actions.state("alice")).toEqual({ signedIn: true, watch: null, copy: null, copyMode: "live" });
  });

  it("assumes copy trades place real orders when the service does not say how it runs them", async () => {
    const { actions } = service({ "GET /v1/watches": [], "GET /v1/copy-trades": [] }); // no /v1/config: the fake answers 404
    expect((await actions.state("alice")).copyMode).toBe("live");
  });

  it("starts and stops a watch", async () => {
    const { actions, fetcher } = service({ "POST /v1/watches": {}, "DELETE /v1/watches/alice": new Response(null, { status: 204 }) });
    await actions.setWatch("Alice", true);
    await actions.setWatch("Alice", false);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ traderHandle: "alice" });
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: "DELETE" });
  });

  it("starts copy trading with the amount, and stops it by deactivating", async () => {
    const { actions, fetcher } = service({ "POST /v1/copy-trades": copyItem("alice", true, 25), "PATCH /v1/copy-trades/alice": copyItem("alice", false) });
    await actions.startCopy("alice", 25);
    await actions.stopCopy("alice");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ traderHandle: "alice", amountUsdc: 25 });
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body))).toEqual({ active: false });
  });

  it("passes the service's own error message through, and falls back to the status", async () => {
    const { actions } = service({
      "POST /v1/watches": new Response(JSON.stringify({ error: "x-follower-id header with a valid UUID is required" }), { status: 400 }),
      "POST /v1/copy-trades": new Response("not json", { status: 502 }),
    });
    await expect(actions.setWatch("alice", true)).rejects.toThrow("x-follower-id header with a valid UUID is required");
    await expect(actions.startCopy("alice", 10)).rejects.toThrow("trading service answered 502");
  });
});

describe("createMockTrading", () => {
  it("keeps choices in memory so the buttons can be tried without a backend, with sample watch numbers", async () => {
    const mock = createMockTrading();
    expect(await mock.state("alice")).toEqual({ signedIn: true, watch: null, copy: null, copyMode: "paper" });
    await mock.setWatch("alice", true);
    await mock.startCopy("alice", 25);
    const state = await mock.state("alice");
    expect(state.watch).toMatchObject({ picks: 9, openPicks: 2, paperPnlUsdc: 0.42, scoreThen: 68 });
    expect(state.copy).toEqual({ active: true, amountUsdc: 25 });
    await mock.stopCopy("alice");
    await mock.setWatch("alice", false);
    expect(await mock.state("alice")).toMatchObject({ watch: null, copy: { active: false, amountUsdc: 25 } });
    expect((await mock.state("bob")).watch).toBeNull();
  });
});

describe("createTradingBridge", () => {
  it("turns each action into a message for the background worker, and a failed reply into an error", async () => {
    const sent: TradingRequest[] = [];
    const bridge = createTradingBridge(async (request): Promise<TradingReply> => {
      sent.push(request);
      return request.op === "state" ? { ok: true, state: { signedIn: true, watch: null, copy: null, copyMode: "paper" as const } } : { ok: true };
    });
    expect(await bridge.state("alice")).toEqual({ signedIn: true, watch: null, copy: null, copyMode: "paper" });
    await bridge.setWatch("alice", false);
    await bridge.startCopy("alice", 10);
    await bridge.stopCopy("alice");
    expect(sent).toEqual([
      { type: "trading", op: "state", handle: "alice" },
      { type: "trading", op: "watch", handle: "alice", on: false },
      { type: "trading", op: "copy-start", handle: "alice", amountUsdc: 10 },
      { type: "trading", op: "copy-stop", handle: "alice" },
    ]);

    const failing = createTradingBridge(async () => ({ ok: false, error: "boom" }));
    await expect(failing.setWatch("alice", true)).rejects.toThrow("boom");
  });

  it("treats a state reply with no state as signed out", async () => {
    expect(await createTradingBridge(async () => ({ ok: true })).state("alice")).toEqual(SIGNED_OUT);
  });
});
