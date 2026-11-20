import { describe, expect, it, vi } from "vitest";
import { RANK_TTL_MS, createRankService } from "./rankService.js";

describe("createRankService", () => {
  it("ranks a handle by its place on the leaderboard, ignoring case, out of the leaderboard's length", async () => {
    const service = createRankService({ fetchLeaderboardHandles: async () => ["sharp", "Steady", "alice", "slump"] });
    expect(await service.get("sharp")).toEqual({ rank: 1, total: 4 });
    expect(await service.get("ALICE")).toEqual({ rank: 3, total: 4 });
    expect(await service.get("steady")).toEqual({ rank: 2, total: 4 });
  });

  it("has no rank for a handle that is not on the leaderboard", async () => {
    const service = createRankService({ fetchLeaderboardHandles: async () => ["sharp"] });
    expect(await service.get("nobody")).toBeNull();
  });

  it("reuses the leaderboard for five minutes, and shares a request already on its way", async () => {
    let t = 0;
    const fetchLeaderboardHandles = vi.fn(async () => ["alice"]);
    const service = createRankService({ fetchLeaderboardHandles, now: () => t });
    await Promise.all([service.get("alice"), service.get("bob")]);
    expect(fetchLeaderboardHandles).toHaveBeenCalledTimes(1);
    t = RANK_TTL_MS - 1;
    await service.get("alice");
    expect(fetchLeaderboardHandles).toHaveBeenCalledTimes(1);
    t = RANK_TTL_MS;
    await service.get("alice");
    expect(fetchLeaderboardHandles).toHaveBeenCalledTimes(2);
  });

  it("answers null when the leaderboard cannot be read, and tries again next time", async () => {
    const fetchLeaderboardHandles = vi.fn().mockRejectedValueOnce(new Error("API down")).mockResolvedValue(["alice"]);
    const service = createRankService({ fetchLeaderboardHandles });
    expect(await service.get("alice")).toBeNull();
    expect(await service.get("alice")).toEqual({ rank: 1, total: 1 });
  });
});
