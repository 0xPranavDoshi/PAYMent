import type { Badge, BadgesResponse, CallEntry, UserProfile } from "@copayme/shared";
import type { ProfileData } from "./messages.js";

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

const GAMES: [string, string, string][] = [
  ["UConn vs Arizona", "UConn", "Arizona"],
  ["Lakers vs Celtics", "Lakers", "Celtics"],
  ["Chiefs vs Bills", "Chiefs", "Bills"],
  ["Oilers vs Flames", "Oilers", "Flames"],
  ["Real Madrid vs Barcelona", "Real Madrid", "Barcelona"],
  ["Yankees vs Red Sox", "Yankees", "Red Sox"],
];

/** A generated profile and five recent picks for any handle with a badge, stable per handle. Not real data. */
export function mockProfileData(handle: string): ProfileData {
  const badge = mockBadges([handle])[handle] ?? null;
  if (!badge) return { profile: null, calls: [] };

  const h = hash(handle + ":calls");
  const profile: UserProfile = {
    ...badge,
    handle,
    nWins: Math.round((badge.hitRate ?? 0) * badge.nResolved),
    skill: 0,
    lastCallAt: new Date(Date.UTC(2026, 10, 19, 12, 0, 0)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 10, 19, 12, 0, 0)).toISOString(),
    latestSnapshot: null,
  };
  const calls: CallEntry[] = Array.from({ length: Math.min(5, Math.max(badge.nResolved, 2)) }, (_, i) => {
    const [eventName, a, b] = GAMES[(h + i) % GAMES.length]!;
    const odds = 0.3 + (((h >>> (i * 3)) % 50) / 100);
    const pending = i === 0 && h % 2 === 0;
    const won = ((h >>> i) & 1) === 1;
    const unpriced = i === 4 && h % 3 === 0;
    return {
      callId: `00000000-0000-4000-8000-${String(h % 1_000_000).padStart(6, "0")}${String(i).padStart(6, "0")}`,
      tweetId: String(1000 + i),
      tweetText: `Taking ${a} tonight. ${b}'s defense is overrated and nobody is talking about it.`,
      tweetedAt: new Date(Date.UTC(2026, 10, 19 - i, 18, 0, 0)).toISOString(),
      eventName,
      pickLabel: (h >>> i) % 3 === 0 ? b : a,
      side: "yes",
      oddsAtCall: unpriced ? null : Math.round(odds * 100) / 100,
      oddsSource: unpriced ? "none" : "snapshot",
      status: pending ? "pending" : "scored",
      result: pending ? null : won ? "won" : "lost",
      points: pending || unpriced ? null : Math.round(((won ? 1 : 0) - odds) * 100) / 100,
    };
  });
  return { profile, calls };
}

/** The demo users, best score first, so mock mode shows a rank ("#1 of 5") for them. */
export function mockLeaderboard(): string[] {
  return Object.entries(DEMO)
    .filter(([, badge]) => badge.tier === "scored")
    .sort(([, a], [, b]) => b.score - a.score)
    .map(([handle]) => handle);
}
