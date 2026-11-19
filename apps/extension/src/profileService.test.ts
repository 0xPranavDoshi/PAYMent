import { describe, expect, it, vi } from "vitest";
import type { ProfileData } from "./messages.js";
import { PROFILE_TTL_MS, createProfileService } from "./profileService.js";

const data = (n: number): ProfileData => ({ profile: null, calls: Array(n).fill(null) });

describe("createProfileService", () => {
  it("reuses a profile for a minute, then fetches again", async () => {
    let t = 0;
    const fetchProfileData = vi.fn(async () => data(1));
    const service = createProfileService({ fetchProfileData, now: () => t });
    await service.get("alice");
    t = PROFILE_TTL_MS - 1;
    await service.get("alice");
    expect(fetchProfileData).toHaveBeenCalledTimes(1);
    t = PROFILE_TTL_MS;
    await service.get("alice");
    expect(fetchProfileData).toHaveBeenCalledTimes(2);
  });

  it("keeps handles separate and shares a request that is already on its way", async () => {
    let release!: (d: ProfileData) => void;
    const fetchProfileData = vi.fn(() => new Promise<ProfileData>((r) => (release = r)));
    const service = createProfileService({ fetchProfileData });
    const a = service.get("alice");
    const b = service.get("alice");
    expect(fetchProfileData).toHaveBeenCalledTimes(1);
    release(data(2));
    expect(await a).toBe(await b);
    service.get("bob");
    expect(fetchProfileData).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure", async () => {
    const fetchProfileData = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(data(1));
    const service = createProfileService({ fetchProfileData });
    await expect(service.get("alice")).rejects.toThrow("down");
    await expect(service.get("alice")).resolves.toEqual(data(1));
  });
});
