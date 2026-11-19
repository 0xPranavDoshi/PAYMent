import { ScoreAt } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { ScoreHistoryStore } from "./history.js";

function setup(result: Awaited<ReturnType<ScoreHistoryStore["scoreAt"]>>) {
  const scoreAt = vi.fn(async (_handle: string, _at: Date) => result);
  const app = createApp({ store: { findByHandles: async () => [], leaderboard: async () => [] }, history: { scoreAt } });
  return { app, scoreAt };
}

describe("GET /v1/users/:handle/score-at", () => {
  it("returns the score as of that moment", async () => {
    const { app, scoreAt } = setup({ score: 66, computedAt: new Date("2026-10-28T12:00:00Z") });
    const res = await app.request("/v1/users/Tipster/score-at?at=2026-11-05T00:00:00Z");
    expect(res.status).toBe(200);
    expect(ScoreAt.parse(await res.json())).toEqual({ score: 66, computedAt: "2026-10-28T12:00:00.000Z" });
    expect(scoreAt).toHaveBeenCalledWith("tipster", new Date("2026-11-05T00:00:00Z"));
  });

  it("returns nulls when they had no score yet at that moment", async () => {
    const { app } = setup(null);
    expect(await (await app.request("/v1/users/tipster/score-at?at=2026-01-01T00:00:00Z")).json()).toEqual({ score: null, computedAt: null });
  });

  it("is 404 for an unknown user, 400 for a bad handle or a missing or malformed time, 503 when not configured", async () => {
    expect((await setup(undefined).app.request("/v1/users/nobody/score-at?at=2026-11-05T00:00:00Z")).status).toBe(404);
    const { app } = setup(null);
    expect((await app.request("/v1/users/not%20valid/score-at?at=2026-11-05T00:00:00Z")).status).toBe(400);
    expect((await app.request("/v1/users/a/score-at")).status).toBe(400);
    expect((await app.request("/v1/users/a/score-at?at=yesterday")).status).toBe(400);
    expect((await app.request("/v1/users/a/score-at?at=2026-11-05")).status).toBe(400);
    const off = createApp({ store: { findByHandles: async () => [], leaderboard: async () => [] } });
    expect((await off.request("/v1/users/a/score-at?at=2026-11-05T00:00:00Z")).status).toBe(503);
  });
});
