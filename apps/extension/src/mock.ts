import type { Badge, BadgesResponse } from "@copayme/shared";

/** Same demo users as the API's seed script, so mock mode and a seeded database look alike. */
const DEMO: Record<string, Badge> = {
  demo_sharp: { score: 82, change14d: 16, tier: "scored", nResolved: 40, hitRate: 0.6 },
  demo_steady: { score: 50, change14d: 1, tier: "scored", nResolved: 30, hitRate: 0.5 },
  demo_slump: { score: 10, change14d: -28, tier: "scored", nResolved: 30, hitRate: 0.3 },
  demo_chalk: { score: 44, change14d: null, tier: "scored", nResolved: 35, hitRate: 0.8 },
  demo_rookie: { score: 63, change14d: null, tier: "new", nResolved: 3, hitRate: 2 / 3 },
};

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Generated badges for any handle, stable per handle, so the extension can be
 * developed on a real x.com timeline without a database. Clearly not real scores.
 */
export function mockBadges(handles: readonly string[]): BadgesResponse {
  const out: BadgesResponse = {};
  for (const handle of handles) {
    const demo = DEMO[handle];
    if (demo) {
      out[handle] = demo;
      continue;
    }
    const h = hash(handle);
    const bucket = h % 100;
    if (bucket < 30) {
      out[handle] = null;
    } else if (bucket < 45) {
      out[handle] = { score: 50, change14d: null, tier: "new", nResolved: 1 + (h % 4), hitRate: 0.5 };
    } else {
      const nResolved = 5 + (h % 36);
      out[handle] = {
        score: 15 + ((h >>> 8) % 76),
        change14d: ((h >>> 16) % 25) - 12,
        tier: "scored",
        nResolved,
        hitRate: 0.3 + ((h >>> 4) % 50) / 100,
      };
    }
  }
  return out;
}
