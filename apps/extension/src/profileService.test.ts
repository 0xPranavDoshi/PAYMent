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

describe("createProfileService: evict", () => {
  it("forgets a handle so the next get reads the new picks, and leaves other handles cached", async () => {
    let picks = 1;
    const fetchProfileData = vi.fn(async () => data(picks));
    const service = createProfileService({ fetchProfileData });
    expect((await service.get("alice")).calls).toHaveLength(1);
    await service.get("bob");
    picks = 3; // a scan stored two more picks
    expect((await service.get("alice")).calls).toHaveLength(1); // still the cached copy
    service.evict("alice");
    expect((await service.get("alice")).calls).toHaveLength(3);
    await service.get("bob");
    expect(fetchProfileData).toHaveBeenCalledTimes(3); // alice twice, bob once
  });

  it("does not cache the answer to a request that started before the eviction", async () => {
    const releases: ((d: ProfileData) => void)[] = [];
    const fetchProfileData = vi.fn(() => new Promise<ProfileData>((r) => releases.push(r)));
    const service = createProfileService({ fetchProfileData });
    const before = service.get("alice"); // in flight: will answer with the old picks
    service.evict("alice"); // the scan finished meanwhile
    const after = service.get("alice"); // a fresh request, not the stale one
    expect(fetchProfileData).toHaveBeenCalledTimes(2);
    releases[0]!(data(1)); // the stale answer arrives late
    releases[1]!(data(3));
    expect((await before).calls).toHaveLength(1);
    expect((await after).calls).toHaveLength(3);
    expect((await service.get("alice")).calls).toHaveLength(3); // cached the new one, not the stale one
    expect(fetchProfileData).toHaveBeenCalledTimes(2);
  });
});
