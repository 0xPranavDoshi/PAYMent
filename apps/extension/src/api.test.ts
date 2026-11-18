import { MAX_BADGE_HANDLES } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import { fetchBadges } from "./api.js";
import { mockBadges } from "./mock.js";

const badge = { score: 72, change14d: 8, tier: "scored", nResolved: 30, hitRate: 0.6 };

function fakeFetch(handler: (handles: string[]) => Record<string, unknown>) {
  return vi.fn(async (input: URL | RequestInfo) => {
    const handles = new URL(String(input)).searchParams.get("handles")!.split(",");
    return new Response(JSON.stringify(handler(handles)), { status: 200 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("fetchBadges", () => {
  it("requests /v1/badges with the handles and parses the reply", async () => {
    const fetcher = fakeFetch((hs) => Object.fromEntries(hs.map((h) => [h, h === "nobody" ? null : badge])));
    const result = await fetchBadges(["alice", "nobody"], fetcher);
    expect(result).toEqual({ alice: badge, nobody: null });
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.pathname).toBe("/v1/badges");
    expect(url.searchParams.get("handles")).toBe("alice,nobody");
  });

  it("splits more than 50 handles into several requests and merges the results", async () => {
    const handles = Array.from({ length: MAX_BADGE_HANDLES + 5 }, (_, i) => `user${i}`);
    const fetcher = fakeFetch((hs) => Object.fromEntries(hs.map((h) => [h, badge])));
    const result = await fetchBadges(handles, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(Object.keys(result)).toHaveLength(handles.length);
  });

  it("rejects when the API fails or replies with something unexpected", async () => {
    const failing = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(fetchBadges(["a"], failing)).rejects.toThrow("500");
    const wrongShape = fakeFetch(() => ({ a: { score: "high" } }));
    await expect(fetchBadges(["a"], wrongShape)).rejects.toThrow();
  });
});

describe("mockBadges", () => {
  it("matches the API seed for the demo users", () => {
    expect(mockBadges(["demo_sharp", "demo_rookie"])).toMatchObject({
      demo_sharp: { score: 82, change14d: 16, tier: "scored" },
      demo_rookie: { tier: "new", nResolved: 3 },
    });
  });

  it("is stable per handle and produces valid badges", () => {
    const first = mockBadges(["somebody", "someoneelse"]);
    expect(mockBadges(["somebody", "someoneelse"])).toEqual(first);
    for (const b of Object.values(first)) {
      if (b) {
        expect(b.score).toBeGreaterThanOrEqual(0);
        expect(b.score).toBeLessThanOrEqual(100);
        expect(b.tier === "new" ? b.nResolved < 5 : b.nResolved >= 5).toBe(true);
      }
    }
  });
});
