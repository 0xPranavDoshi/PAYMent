# UI Redesign (Style D, "Bold outline") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the coPAYMe website and Chrome extension in style D, and add the ticket-style Copy trade flow, exactly as described in the approved spec.

**Architecture:** Design tokens, the score-band rule and the copy-slip maths live in `packages/shared`, so the website and the extension use the same values and the same tested logic. The website keeps plain CSS (`globals.css` plus one token `<style>` injected from shared). The extension keeps CSS strings in shadow roots and builds its token block from the same shared module. The only backend change is adding `skill` to the leaderboard response.

**Tech Stack:** Next.js 15 App Router and React 19 (web), WXT and React 19 (extension), Hono API, zod, and vitest (with happy-dom in the extension).

**Spec:** `docs/superpowers/specs/2026-11-19-ui-redesign-design.md`. Mockups: `docs/superpowers/specs/2026-11-19-ui-redesign-mockups.html` and `docs/superpowers/specs/2026-11-19-ui-redesign-mockups-rewards-how.html`. Read the spec section each task names, and open the matching mockup tab.

## Global Constraints

- Colors are exactly: bg `#F3F1EA`, card `#FBFAF6`, surface `#FFFFFF`, ink `#111111`, ink-2 `#55524B`, ink-3 `#8B877D`, orange `#FF6A1F`, win `#14894B`, win-soft `#C9EFD6`, loss `#E0412D`, loss-soft `#FBD5CF`, amber `#E8A317`, ticket `#F6F2E6`.
- The page background has a 36px graph-paper grid of `rgba(17,17,17,.045)` lines.
- Score bands: green ≥ 60, amber 40–59, red < 40. A "new" tier trader has no band.
- Type: Archivo (600–900) for UI and headlines, JetBrains Mono (500/700) for small labels and figures. Numbers use tabular figures.
- Outlines are 2–2.5px solid. Radius is 8–10px on buttons and chips, 14px on cards. Shadows are solid offsets with no blur: 3px on buttons, 4–6px on cards. A pressed element moves by the offset and loses its shadow.
- **Banned:** score rings and gauges, status dots (no "● LIVE", no dot at the end of a chart line), gradients and glows, and any paper/live wording ("simulate", "simulated", "No real money moves", "Real orders").
- Orange is used only for the brand mark, the #1 rank, and the single primary action in view.
- No Tailwind or component libraries. The website keeps plain CSS. The extension keeps CSS strings in shadow roots.
- `@copayme/tweet-card` must keep rendering tweets that look like X's own. Don't restyle it.
- Animation stays minimal: the pressed-button shift and the ticket opening by height. Both are disabled under `prefers-reduced-motion`.
- Don't run `next build` while `pnpm dev:web` is running, because they share `.next`. Per-task web checks are `typecheck`, `test`, and a screenshot. `next build` runs only in Task 14.
- Screenshot check, used by web tasks:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=1440,2400 --virtual-time-budget=8000 --screenshot=/tmp/shot.png http://localhost:3000/<path>`
  Open the PNG and compare it with the named mockup tab. "Matches" means the same layout, components and colors. Pixel equality is not required.

## Review Focus

1. **Odd prices in "Past week":** `oddsAtCall` of 0, 1, or null must never produce Infinity or NaN. Those picks are skipped. (Task 2)
2. **Nothing to show for the week:** no settled picks in the last 7 days must show "—", and the stepper must keep working. A copied amount that isn't a step (e.g. $7) snaps to the nearest step. (Tasks 2, 6, 13)
3. **Short or empty leaderboards:** fewer than 3 traders must render only the podium cards that exist, with no empty slots. An empty leaderboard shows the empty state instead of a podium. (Task 7)
4. **Long values:** 15-character handles, a score of 100, and a P&L like "−$1,234.56" must not overflow tiles, podium cards, the slip or the popover. They truncate with ellipsis or fit. (Tasks 5, 7, 13)
5. **Odd P&L series:** 0 or 1 points, all-negative, or all-positive series must not produce NaN paths. The $0 line is always drawn. (Task 10)

---

### Task 1: Shared design tokens and score band

**Files:**
- Create: `packages/shared/src/design.ts`
- Create: `packages/shared/src/design.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./design.js";`)

**Interfaces:**
- Produces:
  - `type DesignTokens = Record<"bg"|"card"|"surface"|"ink"|"ink2"|"ink3"|"orange"|"win"|"winSoft"|"loss"|"lossSoft"|"amber"|"ticket"|"line"|"shadow", string>`
  - `const TOKENS: DesignTokens` (light)
  - `const TOKENS_DARK: DesignTokens` (extension on dark X)
  - `function tokensCss(selector: string, tokens: DesignTokens): string`
  - `type ScoreBand = "win" | "amber" | "loss" | "none"`
  - `function scoreBand(score: number | null): ScoreBand`
- CSS custom property names produced by `tokensCss`: `--bg --card --surface --ink --ink-2 --ink-3 --orange --win --win-soft --loss --loss-soft --amber --ticket --line --shadow`. `--line` is the outline color and `--shadow` is the offset-shadow color.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { TOKENS, TOKENS_DARK, tokensCss, scoreBand } from "./design.js";

describe("design tokens", () => {
  it("uses the spec's light values", () => {
    expect(TOKENS).toMatchObject({ bg: "#F3F1EA", ink: "#111111", orange: "#FF6A1F", win: "#14894B", loss: "#E0412D", amber: "#E8A317", ticket: "#F6F2E6", line: "#111111", shadow: "#111111" });
  });
  it("dark variant: cream outlines, orange shadow, brighter win/loss", () => {
    expect(TOKENS_DARK).toMatchObject({ card: "#161616", line: "#F3F1EA", shadow: "#FF6A1F", win: "#6EE59C", loss: "#FF8A78", orange: "#FF6A1F" });
  });
  it("tokensCss emits one custom property per token under the selector", () => {
    const css = tokensCss(":root", TOKENS);
    expect(css.startsWith(":root {")).toBe(true);
    expect(css).toContain("--ink-2: #55524B;");
    expect(css).toContain("--win-soft: #C9EFD6;");
    expect(css).toContain("--shadow: #111111;");
  });
  it.each([[100, "win"], [60, "win"], [59, "amber"], [40, "amber"], [39, "loss"], [0, "loss"], [null, "none"]] as const)(
    "scoreBand(%s) = %s", (score, band) => expect(scoreBand(score)).toBe(band));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**
  Run: `pnpm --filter @copayme/shared test -- design`
  Expected: FAIL, because `./design.js` can't be resolved.

- [ ] **Step 3: Implement `design.ts`**
  Use the light values from Global Constraints, with `line` and `shadow` set to `#111111`. Dark values:
  - bg `#000000`, card `#161616`, surface `#1E1E1E`
  - ink `#F3F1EA`, ink2 `#B9B4A8`, ink3 `#8B877D`
  - orange `#FF6A1F`, amber `#E8A317`
  - win `#6EE59C`, winSoft `rgba(110,229,156,.14)`, loss `#FF8A78`, lossSoft `rgba(255,138,120,.14)`
  - ticket `#1B1B1B`, line `#F3F1EA`, shadow `#FF6A1F`

  `tokensCss` converts camelCase keys to kebab case, with digits split (`ink2` becomes `--ink-2`).

- [ ] **Step 4: Run the tests and confirm they pass**
  Run: `pnpm --filter @copayme/shared test -- design`
  Expected: PASS

- [ ] **Step 5: Commit**
  `git add packages/shared/src/design.ts packages/shared/src/design.test.ts packages/shared/src/index.ts && git commit -m "shared: design tokens and score bands for style D"`

---

### Task 2: Shared copy-slip logic

**Files:**
- Create: `packages/shared/src/copySlip.ts`
- Create: `packages/shared/src/copySlip.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./copySlip.js";`)

**Interfaces:**
- Consumes: `CallEntry` from `./calls.js`
- Produces:
  - `const COPY_STEPS: readonly number[]`, which is `[1, 5, 10, 25, 50, 100]`
  - `const DEFAULT_COPY_AMOUNT = 10`
  - `function snapToStep(amount: number): number`: the nearest step. Ties go to the larger step. The result is clamped to the first and last step.
  - `function stepAmount(current: number, dir: 1 | -1): number`: snaps first, then moves one step and clamps at the ends.
  - `function pastWeekEarnings(calls: readonly CallEntry[], amountUsdc: number, now: Date): number | null`: dollars rounded to cents, or `null` when no picks qualify.
  - `function recentSettled(calls: readonly CallEntry[], n?: number): CallEntry[]`: settled calls (`result !== null`), newest `tweetedAt` first, at most `n`, with a default of 3.

- [ ] **Step 1: Write the failing tests** (use a `call()` factory that fills the remaining `CallEntry` fields)

```ts
const now = new Date("2026-11-19T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const call = (p: Partial<CallEntry>): CallEntry => ({ callId: crypto.randomUUID(), tweetId: "1", tweetedAt: daysAgo(1), tweetText: "", eventName: "E", pickLabel: "P", side: "yes", oddsAtCall: 0.5, oddsSource: "history", status: "scored", result: "won", points: 0.5, ...p });

it("matches the mockup's past week: 5 picks at $10 = +$15.81", () => {
  const calls = [call({ oddsAtCall: 0.55, result: "lost" }), call({ oddsAtCall: 0.35 }), call({ oddsAtCall: 0.58 }), call({ oddsAtCall: 0.45, result: "lost" }), call({ oddsAtCall: 0.5 })];
  expect(pastWeekEarnings(calls, 10, now)).toBe(15.81);
});
it("a win at 52¢ for $10 earns $9.23", () => expect(pastWeekEarnings([call({ oddsAtCall: 0.52 })], 10, now)).toBe(9.23));
it("skips pending, void, unpriced, 0 and 1 prices, and picks older than 7 days", () => {
  const skipped = [call({ result: null, status: "pending" }), call({ status: "void", result: null }), call({ oddsAtCall: null }), call({ oddsAtCall: 0 }), call({ oddsAtCall: 1 }), call({ tweetedAt: daysAgo(8) })];
  expect(pastWeekEarnings(skipped, 10, now)).toBeNull();
  expect(pastWeekEarnings([...skipped, call({ result: "lost" })], 10, now)).toBe(-10);
});
it("snapToStep / stepAmount", () => {
  expect(snapToStep(7)).toBe(5); expect(snapToStep(7.5)).toBe(10); expect(snapToStep(0.5)).toBe(1); expect(snapToStep(500)).toBe(100);
  expect(stepAmount(10, 1)).toBe(25); expect(stepAmount(10, -1)).toBe(5); expect(stepAmount(1, -1)).toBe(1); expect(stepAmount(100, 1)).toBe(100); expect(stepAmount(7, 1)).toBe(10);
});
it("recentSettled returns the 3 newest settled picks", () => {
  const r = recentSettled([call({ tweetedAt: daysAgo(5), pickLabel: "old" }), call({ result: null }), call({ tweetedAt: daysAgo(1), pickLabel: "a" }), call({ tweetedAt: daysAgo(2), pickLabel: "b" }), call({ tweetedAt: daysAgo(3), pickLabel: "c" })]);
  expect(r.map((c) => c.pickLabel)).toEqual(["a", "b", "c"]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**
  Run: `pnpm --filter @copayme/shared test -- copySlip`
  Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `copySlip.ts`**
  - A pick qualifies when `result` is "won" or "lost", `oddsAtCall` is not null and is strictly between 0 and 1, and `tweetedAt` falls in `(now − 7 days, now]`.
  - A win earns `A × (1/odds − 1)` and a loss earns `−A`.
  - Sum unrounded, then round the total once with `Math.round(x * 100) / 100`.

- [ ] **Step 4: Run the tests and confirm they pass**
  Run: `pnpm --filter @copayme/shared test`
  Expected: PASS, including the existing tests.

- [ ] **Step 5: Commit**
  `git commit -am "shared: copy slip maths (steps, past-week earnings, recent picks)"` (run `git add` on the two new files first)

---

### Task 3: API: edge (`skill`) on the leaderboard

**Files:**
- Modify: `packages/shared/src/leaderboard.ts:8`
- Modify: `apps/api/src/app.ts:257`
- Test: `apps/api/src/app.test.ts` (the `GET /v1/leaderboard` describe, around line 145)

**Interfaces:**
- Produces: `LeaderboardEntry = Badge.extend({ handle: z.string(), skill: z.number() })`. `skill` is the average points per pick, in dollars, so 0.11 means +11¢. It's the same value as `UserProfile.skill`.

- [ ] **Step 1: Update the test.** In "returns badge fields plus the handle…", add `skill` to both expected objects, taking the value from the `row()` fixture's `skill` field. Read that field's default from the `row()` helper at the top of `app.test.ts`.
- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `pnpm --filter @copayme/api test -- app`
  Expected: FAIL, because `skill` is missing.
- [ ] **Step 3: Implement.** Extend `LeaderboardEntry`, and map `skill: row.skill` in the leaderboard route. `ScoreRow` already has `skill`, so the store doesn't change.
- [ ] **Step 4: Run the tests and confirm they pass.**
  Run: `pnpm --filter @copayme/api test && pnpm --filter @copayme/shared test && pnpm -r typecheck`
  Expected: all PASS.
  Then check live data: `curl -s localhost:8787/v1/leaderboard | head -c 200` shows `"skill":`.
- [ ] **Step 5: Commit.** `git commit -am "api: include skill (edge) in leaderboard entries"`

---

### Task 4: Web foundation: fonts, tokens, base CSS, nav, footer

Spec sections: "Visual system" and "Pages → Nav". Mockup: any tab's nav.

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Rewrite: `apps/web/src/app/globals.css` (base and shared component classes only; page classes come in later tasks)
- Modify: `apps/web/src/components/Nav.tsx`, `NavLinks.tsx`, `Mark.tsx`, `SearchBox.tsx` (styling and markup only)
- Modify: `apps/web/package.json` (add `"test": "vitest run"`, because later tasks add lib tests)

**Interfaces:**
- Consumes: `TOKENS` and `tokensCss` from `@copayme/shared`
- Produces: the global CSS classes used by every later web task:
  - `.btn`, `.btn.primary` (orange), `.btn.sm`, `.btn.lg`, `.btn.xl`, `.btn.dark` (ink fill with orange shadow), `.btn.pressed`
  - `.chip`, `.chip.up`, `.chip.down`, `.chip.mono`, `.tag`
  - `.card` (outline, 14px radius, 6px shadow)
  - `.strip` (stat strip, with `> div > span` as the caption and `b` as the value)
  - `.hitbar` (an outlined track, filled via `--v`)
  - `.pt` (page title, 900 weight, about 72px) and `.psub`
  - `.sech` (section header row) and `.h2`
  - `.up`, `.down`, `.muted`, `.mono`

- [ ] **Step 1: Layout.**
  - Replace Geist with `Archivo` (weights 500–900) and `JetBrains_Mono` (500 and 700) from `next/font/google`, as CSS variables `--font-sans` and `--font-mono`.
  - Inject `<style>{tokensCss(":root", TOKENS)}</style>` next to the existing tweet-card style.
  - Change the footer text to exactly "Scores are measured against market odds." and remove "Copy trades are simulated.".
- [ ] **Step 2: Rewrite `globals.css`.**
  - Delete the `prefers-color-scheme` block (no website dark mode). Delete every gradient and glow.
  - Body background is `var(--bg)` plus the 36px grid.
  - Define the classes listed under Produces, with the outline, radius and shadow values from Global Constraints.
  - Keep any class still used by pages that aren't restyled yet, until their task replaces it. Check with `grep -rn 'className=' apps/web/src`.
- [ ] **Step 3: Nav.**
  - Logo: an outlined orange rounded square with a 2px shadow, plus the "coPAYMe" wordmark in Archivo 800.
  - An outlined search box, plain links, and a 2.5px underline on the active link. The bottom border is 2.5px ink.
  - Right side: an orange "Sign in" button, or the account pill (initial plus handle) when signed in.
- [ ] **Step 4: Verify.**
  Run: `pnpm --filter @copayme/web typecheck`. Expected: no errors.
  Then take a screenshot of `/how-scoring`. Expected: the new nav, cream grid background, Archivo type, and the new footer text.
- [ ] **Step 5: Commit.** `git commit -am "web: style D foundation (fonts, tokens, base components, nav, footer)"`

---

### Task 5: Web score tile (replaces ScoreRing)

Spec section: "Core components → Score tile".

**Files:**
- Create: `apps/web/src/components/ScoreTile.tsx`
- Delete: `apps/web/src/components/ScoreRing.tsx`
- Modify: every importer of ScoreRing (`app/page.tsx`, `app/traders/[handle]/page.tsx`, `app/watchlist/page.tsx`, `components/LeaderboardTable.tsx`, `components/TraderGrid.tsx`)
- Modify: `apps/web/src/lib/format.ts` (remove `scoreHue` if nothing uses it any more)

**Interfaces:**
- Consumes: `scoreBand` from `@copayme/shared`
- Produces: `export default function ScoreTile({ score, size = "sm" }: { score: number | null; size?: "sm" | "lg" })`.
  - `sm` is about 46px with a 6px strip. `lg` is about 128px with a 14px strip and a "SCORE" mono caption.
  - `score === null` renders "NEW" in mono ink-3 with no colored strip.
  - The strip color is `var(--win)`, `var(--amber)` or `var(--loss)`, according to the band.

- [ ] **Step 1: Implement `ScoreTile` and swap every usage. Delete `ScoreRing.tsx`.**
- [ ] **Step 2: Verify.**
  Run: `pnpm --filter @copayme/web typecheck && grep -rn "ScoreRing\|scoreHue" apps/web/src`. Expected: typecheck passes and grep finds nothing.
  Then take a screenshot of `/`. Expected: square tiles, with no rings anywhere. A score of 100 fits inside the `sm` tile.
- [ ] **Step 3: Commit.** `git commit -am "web: score tile replaces score ring"`

---

### Task 6: Web copy ticket (one shared component), retire CopyButton

Spec sections: "Copy trade: the ticket" (all of it) and "Copy mode". Mockup tab: "Leaderboard + copy ticket".

**Files:**
- Create: `apps/web/src/components/CopyTicket.tsx` (`"use client"`)
- Modify: `apps/web/src/lib/actions.ts` (add `getTicketCalls`)
- Modify: `apps/web/src/components/TradeButtons.tsx` (delete `CopyButton` and all paper/live text; restyle `WatchButton` as a secondary `.btn`)
- Modify: `apps/web/src/lib/api.ts` (delete `fetchCopyMode`); remove its imports in `portfolio`, `watchlist` and `traders/[handle]`
- Modify: `globals.css` (add the ticket classes)

**Interfaces:**
- Consumes:
  - `COPY_STEPS`, `DEFAULT_COPY_AMOUNT`, `snapToStep`, `stepAmount`, `pastWeekEarnings` and `recentSettled` (Task 2)
  - the existing server actions `startCopy(handle, amountUsdc)` and `stopCopy(handle)` in `lib/actions.ts`
  - `formatCents` and `formatUsd` from `lib/format.ts`
- Produces:
  - `export async function getTicketCalls(handle: string): Promise<CallEntry[]>`, a server action that calls `fetchTraderCalls(handle, 50)` and returns `[]` on error.
  - `export default function CopyTicket(props: { handle: string; copy: { active: boolean; amountUsdc: number } | null; signedIn: boolean; nPicks: number; variant: "row" | "card"; onClose?: () => void })`
    - `variant: "row"` sits inside a table: full-width, with scalloped side edges.
    - `variant: "card"` stands alone under the profile header card, with the same shape.
    - When signed out, the button reads "Sign in to copy" and links to `/signin`.
  - `export function CopyTradeToggle(props: { handle: string; copy: { active: boolean; amountUsdc: number } | null; signedIn: boolean; nPicks: number; primary?: boolean; ticketPlacement: "below" | "inline" })`: the button that opens and closes a `CopyTicket`.
    - Not copying: "Copy trade" (primary or secondary). While open, it gets the `.pressed` style and the label "Copy trade ▴".
    - Copying: "✓ Copying · $X", styled `.btn.dark`. It opens the ticket in its copying state.
    - Pages place the ticket via `ticketPlacement`. For "below", the caller renders `<CopyTicket>` in the next row using state the toggle lifts through an `onOpenChange?: (open: boolean) => void` prop.
- Ticket content and behavior (from the spec):
  - **Left side, "RECENT PICKS":** `recentSettled(calls)` in a mono table with columns MARKET (`pickLabel`) / POSTED AT (`YES|NO 52¢`) / RESULT (Won or Lost) / EDGE (`formatCents(points)`), then "See all N picks →" linking to `/traders/<handle>`.
  - **Right stub, choosing state:**
    - "COPY TRADE @handle"
    - `Amount per pick` with a dotted leader and a stepper (− | $X | +), driven by `stepAmount`. It starts at `snapToStep(copy.amountUsdc)` if copying, otherwise `DEFAULT_COPY_AMOUNT`.
    - `Past week` with a dotted leader and `pastWeekEarnings(calls, amount, new Date())`, formatted with `formatUsd`, green or red. Show "—" when null.
    - A full-width primary "Copy trade" button. Nothing else.
  - **Copying state:**
    - A green tilted stamp, "Copying @handle", with the caption "$X PER PICK · SINCE <date>" when the date is known, otherwise "$X PER PICK".
    - "Change amount" switches to the choosing state, where the button reads "Save".
    - "Stop copying" in red text calls `stopCopy`.
    - The line "See every copied pick in Portfolio."
  - Calls load on first open via `getTicketCalls`. While loading, the left side shows a mono "Loading picks…" and Past week shows "—".

- [ ] **Step 1: Implement `getTicketCalls`, `CopyTicket` and `CopyTradeToggle`. Delete `CopyButton`, `fetchCopyMode`, and all paper/live strings.**
- [ ] **Step 2: Verify the banned wording is gone.**
  Run: `grep -rniE "simulat|real orders|no real money|copyMode|fetchCopyMode" apps/web/src`. Expected: no output.
  Then run: `pnpm --filter @copayme/web typecheck`. Expected: PASS. (Pages still compile because Tasks 7–11 swap them to `CopyTradeToggle`. Until then, temporarily render `CopyTradeToggle` where `CopyButton` was.)
- [ ] **Step 3: Check the behavior by hand.**
  - Sign in as the demo user. If needed, set `DEFAULT_FOLLOWER_ID` to a real `users.id` in `apps/web/.env.local`.
  - On `/traders/covers`, open the ticket, step the amount from $10 to $25 and back, and see Past week change or show "—".
  - Press Copy trade and see the stamp. Then press Stop copying and see the toggle return.
- [ ] **Step 4: Commit.** `git commit -am "web: shared copy ticket with order slip; remove CopyButton and paper/live wording"`

---

### Task 7: Web leaderboard: podium, table, ticket rows, Edge and filters

Spec section: "Pages → Leaderboard" and "Data". Mockup tab: "Leaderboard + copy ticket".

**Files:**
- Modify: `apps/web/src/app/leaderboard/page.tsx`
- Rewrite: `apps/web/src/components/LeaderboardTable.tsx` (`"use client"`; owns which row's ticket is open)
- Create: `apps/web/src/components/Podium.tsx`
- Create: `apps/web/src/lib/leaderboard.ts` and `apps/web/src/lib/leaderboard.test.ts`

**Interfaces:**
- Consumes: `LeaderboardEntry` with `skill` (Task 3), `ScoreTile` (Task 5), `CopyTradeToggle` and `CopyTicket` (Task 6)
- Produces:
  - `export const FILTERS: { id: "all" | "beating" | "rising" | "new"; label: string; test: (e: LeaderboardEntry) => boolean }[]`, with labels "All", "Beating market", "Rising", "New". The tests are: all → true; beating → `e.tier === "scored" && e.skill > 0`; rising → `(e.change14d ?? 0) >= 2`; new → `e.tier === "new"`.
  - `export function podiumOrder<T>(top: T[]): T[]`: `[#2, #1, #3]` when there are 3, `[#2, #1]` when there are 2, `[#1]` when there is 1, and `[]` when there are none.
  - `export function rankOf(board: LeaderboardEntry[], handle: string): { rank: number; total: number } | null`

- [ ] **Step 1: Write the failing tests** in `lib/leaderboard.test.ts`:
  - `podiumOrder(["a","b","c"])` equals `["b","a","c"]`, `podiumOrder(["a","b"])` equals `["b","a"]`, `podiumOrder(["a"])` equals `["a"]`, and `podiumOrder([])` equals `[]`.
  - `FILTERS.find(f=>f.id==="beating")!.test` is true for `{tier:"scored",skill:0.02}`, false for `skill:0`, and false for `tier:"new"`.
  - `rankOf` is `{rank:2,total:3}` for the second handle, and `null` for a missing handle.
- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `pnpm --filter @copayme/web test`
  Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement the lib file, then the components.**
  - **Podium:**
    - #1 is raised by about 12px, with an orange rank, a "+Δ" green chip when `change14d` > 0 and a primary `CopyTradeToggle`. #1's toggle opens the ticket under table row 1.
    - #2 and #3 show "HIT RATE x% / EDGE y¢ · 14D ±n" in mono, or "NEW".
  - **Table:**
    - Columns: #, ScoreTile, trader (initials avatar plus handle, with "N picks" under it), 14 days (▲/▼, colored), Picks, Hit rate (`.hitbar`), Edge (`formatCents(skill)`, colored), and Action (`CopyTradeToggle`; primary on row 1, secondary on the others).
    - Opening a row's ticket closes any other open ticket. The ticket renders as the next row.
  - Filters: a segmented control above the podium. The podium always shows the overall top 3, and the filter applies to the table.
  - Handles longer than the column truncate with `text-overflow: ellipsis`.
- [ ] **Step 4: Verify.**
  Run: `pnpm --filter @copayme/web test && pnpm --filter @copayme/web typecheck`. Expected: PASS.
  Then take a screenshot of `/leaderboard`. Expected: it matches the mockup tab (podium plus table), and opening a ticket matches its left and right halves.
- [ ] **Step 5: Commit.** `git commit -am "web: leaderboard podium, table, edge column, ticket rows"`

---

### Task 8: Web homepage

Spec section: "Pages → Homepage". Mockup tab: "Homepage".

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Rewrite: `apps/web/src/components/ExtensionPromo.tsx` (becomes the hero call-to-action pair)
- Create: `apps/web/src/components/PickTicker.tsx`
- Modify or delete: `apps/web/src/components/TraderGrid.tsx` (replaced by the "Top traders" list; delete it if unused)

**Interfaces:**
- Consumes: `fetchLeaderboard`, `fetchRecentCalls` (existing), `ScoreTile`, `CopyTradeToggle` and `CopyTicket`
- Produces: `export default function PickTicker({ calls }: { calls: RecentCall[] })`: a black full-width strip. It has "LIVE PICKS" in orange mono text with no dot, followed by `@handle pickLabel YES|NO 52¢` items. YES is `#6EE59C` and NO is `#FF8A78`. It overflows hidden, with no animation.

- [ ] **Step 1: Implement the hero.**
  - The headline is "Every pick on X, scored against the market.", with "scored" on an orange skewed highlighter bar.
  - Then the lede, "Add to Chrome" (disabled, with the label "Coming soon"), and "See the leaderboard".
  - The product shot on the right is static markup: a tweet card with a badge, the popover, and a tilted green "+11¢ per pick" sticker.
- [ ] **Step 2: Implement the rest of the page:** the ticker, the three step cards (copy from the mockup), "Top traders" (top 3 rows with `CopyTradeToggle`, whose ticket opens below the row), and "Latest picks" (with a PENDING tag or a result chip).
- [ ] **Step 3: Verify.**
  Run: `pnpm --filter @copayme/web typecheck && grep -n "●" -r apps/web/src`. Expected: typecheck passes and grep finds nothing.
  Then take a screenshot of `/`. Expected: it matches the Homepage tab.
- [ ] **Step 4: Commit.** `git commit -am "web: homepage in style D"`

---

### Task 9: Web trader profile

Spec section: "Pages → Trader profile" and "Data". Mockup tab: "Trader profile".

**Files:**
- Modify: `apps/web/src/app/traders/[handle]/page.tsx`
- Modify: `apps/web/src/components/PickRow.tsx`

**Interfaces:**
- Consumes: `rankOf` and `fetchLeaderboard` (Task 7), `ScoreTile` (lg), and `CopyTradeToggle` / `CopyTicket` with `variant: "card"`

- [ ] **Step 1: Header card.**
  - A large ScoreTile and the handle in Archivo 900 at about 52px.
  - Chips: Δ14d (green or red, hidden when null), "#R of N" (hidden when `rankOf` is null), then "Last pick … · View on X ↗".
  - On the right, a primary Copy trade toggle and Watch. The ticket opens directly under the header card.
- [ ] **Step 2: Stat strip and picks.**
  - Strip: Record (W green, L red), Hit rate, Edge per pick, Resolved.
  - Picks rows (PickRow): mono date, `pickLabel` with `eventName` under it, a price chip ("YES 52¢"), and either a result chip ("WON +39¢" or "LOST −47¢") or a PENDING tag.
  - No score chart, no sports chips, no market type.
- [ ] **Step 3: Verify.**
  Run: `pnpm --filter @copayme/web typecheck`.
  Then take screenshots of `/traders/covers` and `/traders/demo_sharp`. Expected: they match the Trader profile tab. A "new" trader shows NEW in the tile. A handle not on the leaderboard shows no rank chip.
- [ ] **Step 4: Commit.** `git commit -am "web: trader profile in style D"`

---

### Task 10: Web portfolio and P&L chart A

Spec sections: "Pages → Portfolio" and "P&L chart A". Mockup tab: "Portfolio".

**Files:**
- Rewrite: `apps/web/src/components/PnlChart.tsx` (a custom SVG; `"use client"` for hover)
- Create: `apps/web/src/lib/pnlChart.ts` and `apps/web/src/lib/pnlChart.test.ts`
- Modify: `apps/web/src/app/portfolio/page.tsx`
- Modify: `apps/web/package.json` (remove `recharts`), then run `pnpm install`

**Interfaces:**
- Consumes: the existing `PnlPoint` shape `{ label: string; cumulative: number }`
- Produces: `export function pnlGeometry(points: { cumulative: number }[], width: number, height: number): { line: string; area: string; zeroY: number; ticks: { value: number; y: number }[]; xs: number[]; last: { x: number; y: number } | null }`
  - The y domain always includes 0, padded 10%. Ticks are 4–5 "nice" dollar steps.
  - `line` and `area` are SVG path strings.
  - With 0 points, return empty paths and `last: null`. With 1 point, return a flat line from x=0 to `width` at that value.
  - Every returned number is finite.

- [ ] **Step 1: Write the failing tests:**
  - With `[]`, `line === ""` and `last === null`.
  - With one point `[{cumulative:2}]`, `line` contains no "NaN", and `zeroY` is greater than `last.y`.
  - With an all-negative series `[-1,-3,-2]`, `zeroY` is less than every point's y, and 0 is among the tick values.
  - With an all-positive series, every coordinate parsed from `line` is finite.
  - For the mockup's series `[0,0.64,0.34,1.26,-0.74,0.36,0.84,0.84,2.19,1.57,3.28,3.68,3.30,4.82]`, `last.y` is less than `zeroY`, and the tick values include 0.
- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `pnpm --filter @copayme/web test -- pnlChart`
  Expected: FAIL
- [ ] **Step 3: Implement `pnlGeometry`, then `PnlChart`.**
  - **Card header:**
    - Left: total P&L big (green or red), a return chip, and "on $X copied · last N days".
    - Right: a 1W / 2W / 1M / All segmented control that filters points by date on the client.
  - **The chart:**
    - The area is clipped to `win-soft` above `zeroY` and `loss-soft` below.
    - A 3.5px ink line, a solid 2.5px $0 line, and dashed faint ticks with `$n` mono labels on the right.
    - The last value gets an outlined tag with a solid shadow and a short tick. No dot.
  - **Hover:** a dashed crosshair plus an outlined tooltip showing the date, that day's change, and "total $x".
- [ ] **Step 4: Portfolio page.**
  - Title and subtitle "Trades from the traders you copy and watch." (one fixed string). No PAPER MODE.
  - A strip with Total P&L / Return / Open trades / Settled W–L.
  - The chart, shown when there are 2 or more points.
  - "Copy trading" rows: tile, handle, "$X per pick · N trades since …", P&L, and `CopyTradeToggle`, whose ticket opens below the row in its copying state.
  - "Trades" rows: event, a mono detail line, an Open/Won/Lost chip, and P&L with "+x% on $y".
- [ ] **Step 5: Verify.**
  Run: `pnpm install && pnpm --filter @copayme/web test && pnpm --filter @copayme/web typecheck && grep -rn "recharts\|PAPER MODE" apps/web`. Expected: tests and typecheck pass, and grep finds nothing.
  Then take a screenshot of `/portfolio` while signed in. Expected: it matches the Portfolio tab.
- [ ] **Step 6: Commit.** `git commit -am "web: portfolio and P&L chart A (custom SVG, recharts removed)"`

---

### Task 11: Web rewards, how it works, watchlist, sign in

Spec sections: "Pages → Rewards", "How it works", and "Watchlist, Sign in, Activity". Mockup file: `…mockups-rewards-how.html`.

**Files:**
- Modify: `apps/web/src/components/RewardsPanel.tsx`, `apps/web/src/app/rewards/page.tsx`
- Modify: `apps/web/src/app/how-scoring/page.tsx`
- Create: `apps/web/src/components/ScoreCurve.tsx` (the static SVG for section 3)
- Modify: `apps/web/src/app/watchlist/page.tsx`, `apps/web/src/app/signin/page.tsx`, `apps/web/src/components/SignInPrompt.tsx`
- Modify: `globals.css` (page classes)

**Interfaces:**
- Consumes: the existing `RewardsPanel` props and actions (behavior unchanged), `ScoreTile`, and `CopyTradeToggle`
- Produces: `export default function ScoreCurve()`, which plots `50 + 50·tanh(edge/0.15)` for edge from −30¢ to +30¢, with tags "−15¢ → 12", "no edge → 50" and "+15¢ edge → 88". Tags have leader lines and no dots.

- [ ] **Step 1: Rewards.**
  - The payout ticket: left side shows "AVAILABLE TO CASH OUT", the huge amount plus "USDC", and a "+$X this week" chip. The chip only appears when the earnings rows give a non-zero sum over the last 7 days.
  - The stub holds "Cash out to wallet" plus "to 0x…… on Arc", or the existing guidance text when the user can't cash out yet.
  - Then the strip, and the wallet pane with the square-knob toggle (`role="switch"`, `aria-checked`). The toggle keeps the current `setOptInAction` behavior.
  - The activity ledger maps reasons: `copy_reward` shows as "Copy reward", `tail_reward` as "Tail reward", and `redeem` as "Cashed out". It keeps the tx ↗ link.
  - Finally the "How you earn" cards (2% / 1¢ / Any time).
- [ ] **Step 2: How it works.** The hero, a row of section chips, then 5 numbered sections, each with text and a visual exactly as in the spec. The 14-day callout goes at the end. Keep the current copy text.
- [ ] **Step 3: Watchlist and sign in.** Watchlist rows: ScoreTile, handle, details, `CopyTradeToggle` (ticket below the row), and `WatchButton`. Sign in and SignInPrompt get the page title and outlined card styles.
- [ ] **Step 4: Verify.**
  Run: `pnpm --filter @copayme/web typecheck`.
  Then take screenshots of `/rewards` (signed in, with `pnpm dev:onchain` running and `STORE=memory`), `/how-scoring` and `/watchlist`. Expected: Rewards and How it works match the mockup tabs. Watchlist uses the shared components.
- [ ] **Step 5: Commit.** `git commit -am "web: rewards, how it works, watchlist, sign in in style D"`

---

### Task 12: Extension tokens, fonts, badge, scan card, Rescan, dark variant

Spec section: "Extension" (minus the popover's internals) and "Dark-mode X uses variant B".

**Files:**
- Rewrite: `apps/extension/src/styles.ts` (`TOKENS_CSS`, `BADGE_CSS`, `SCAN_CSS`; `POPOVER_CSS` comes in Task 13)
- Modify: `apps/extension/src/brand.tsx` (replace `Gauge` with `ScoreTile`; keep `Mark`, now the outlined orange square)
- Modify: `apps/extension/src/Badge.tsx`, `apps/extension/src/ScanCard.tsx` (markup and classes only)
- Create: `apps/extension/public/fonts/archivo.woff2`, `apps/extension/public/fonts/jetbrains-mono.woff2`
- Create: `apps/extension/src/fonts.ts`
- Modify: `apps/extension/wxt.config.ts` (`web_accessible_resources` for `fonts/*` on `https://x.com/*`)
- Modify: `apps/extension/entrypoints/content.tsx` (call `injectFonts()` once at startup)
- Test: `apps/extension/src/brand.test.tsx` (update), `apps/extension/src/page.test.tsx` (update any class or text assertions)

**Interfaces:**
- Consumes: `TOKENS`, `TOKENS_DARK`, `tokensCss` and `scoreBand` (Task 1)
- Produces:
  - `TOKENS_CSS = tokensCss(":host", TOKENS) + tokensCss(':host([data-theme="dark"])', TOKENS_DARK)` plus the font stacks `--font: "Archivo", "Helvetica Neue", Arial, sans-serif` and `--mono: "JetBrains Mono", ui-monospace, Menlo, monospace`. The X tweet colors (`--tw-*`) are kept unchanged.
  - `export function ScoreTile({ score, size }: { score: number | null; size: "sm" | "lg" })` in `brand.tsx`
  - `export function injectFonts(doc?: Document): void` in `fonts.ts`. It adds one `<style data-copayme-fonts>` to `document.head` with `@font-face` rules for "Archivo" (variable, 500–900) and "JetBrains Mono" (500 and 700), using `browser.runtime.getURL("/fonts/…")`. It's idempotent.
  - Every border uses `var(--line)` and every offset shadow uses `var(--shadow)`, so the dark variant needs no extra rules beyond the tokens.

- [ ] **Step 1: Update the tests first.**
  - In `brand.test.tsx`, replace the Gauge tests with ScoreTile tests: it renders the score text, `score=null` renders "NEW", and the strip element's class matches `scoreBand` ("win" for 82, "amber" for 47, "loss" for 10).
  - Add a `fonts.test.ts` with two checks: calling `injectFonts(document)` twice leaves exactly one `style[data-copayme-fonts]`, and its text contains `font-family: "Archivo"`.
- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `pnpm --filter @copayme/extension test -- brand fonts`
  Expected: FAIL
- [ ] **Step 3: Implement.**
  - Fonts: copy the woff2 files from Google Fonts (Archivo variable latin, JetBrains Mono latin 500 and 700) into `public/fonts/`.
  - Badge: a white outlined chip with a 2px shadow, containing the orange mark square, the score and the colored Δ. The NEW and scanning states use dashed outlines.
  - Scan card and profile pill: outlined card styles. **Rescan** is a secondary outlined button.
- [ ] **Step 4: Run the tests and confirm they pass.**
  Run: `pnpm --filter @copayme/extension test && pnpm --filter @copayme/extension typecheck`
  Expected: PASS
- [ ] **Step 5: Check by hand.**
  - Load `apps/extension/.output/chrome-mv3-dev` unpacked, then open x.com in light mode and in dark mode (Settings → Display).
  - Expected: badges match the mockup's extension tabs. On dark X, badges are dark with cream outlines and an orange shadow. Archivo renders (check DevTools → Computed → Rendered fonts).
- [ ] **Step 6: Commit.** `git commit -am "extension: style D tokens, bundled fonts, badge, scan card, dark variant"`

---

### Task 13: Extension popover and copy stub

Spec sections: "Extension → Popover", "Copy trade: the ticket → In the extension popover", "Copy mode", and "Data" (rank). Mockup tabs: "Extension copy ticket" and "Extension on dark X".

**Files:**
- Modify: `apps/extension/src/popover/Popover.tsx`
- Modify: `apps/extension/src/styles.ts` (`POPOVER_CSS`)
- Modify: `apps/extension/src/popover/view.ts` (remove the helpers the new UI no longer uses, e.g. `parseAmount`, if unused)
- Modify: `apps/extension/src/trading.ts` (remove `copyMode` from `TradingState`, `SIGNED_OUT` and `copyMode()`)
- Modify: `apps/extension/entrypoints/background.ts` and `apps/extension/src/messages.ts` (add a cached rank lookup)
- Test: `apps/extension/src/popover/popover.test.tsx`, `apps/extension/src/trading.test.ts`

**Interfaces:**
- Consumes: `COPY_STEPS`, `DEFAULT_COPY_AMOUNT`, `snapToStep`, `stepAmount`, `pastWeekEarnings` and `recentSettled` (Task 2); `ScoreTile` (Task 12); the existing `trading.startCopy(handle, amount)` and `trading.stopCopy(handle)`; the popover's existing `calls: CallEntry[]`
- Produces:
  - A background message `{ type: "rank"; handle: string }` that returns `{ rank: number; total: number } | null`. It's computed from `GET /v1/leaderboard?limit=100`, cached in memory for 5 minutes, and returns `null` on error.
  - A new optional popover prop: `rank: { rank: number; total: number } | null`.

- [ ] **Step 1: Update `popover.test.tsx` first.**
  - Delete the assertions about "This is simulated" and "This places real orders" (around lines 571–583) and the preset-chip and custom-amount tests.
  - Add these tests:
    1. Pressing "Copy trade" shows a stub containing "Amount per pick", a stepper showing "$10", and "Past week".
    2. Pressing "+" shows "$25". Pressing "−" twice from $25 shows "$5".
    3. With calls that qualify (at 52¢, won, 1 day old), Past week shows "+$9.23" at $10. With no qualifying calls, it shows "—".
    4. Confirming calls `startCopy(handle, 10)`, then shows "Copying @handle" with "Change amount" and "Stop copying".
    5. "Stop copying" calls `stopCopy(handle)`.
    6. An existing copy at $7 opens the stepper at $5.
    7. With `rank` set, the header shows "#2 of 7". With `rank` null, no rank text appears.
    8. The rendered text never matches `/simulat|real orders|no real money/i`.
  - In `trading.test.ts`, remove the copy-mode expectations.
- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `pnpm --filter @copayme/extension test -- popover trading`
  Expected: FAIL
- [ ] **Step 3: Implement.**
  - **Popover layout:**
    - Header: handle, then "N resolved", then "· #R of N" when rank is present; the big score sits on the right.
    - A three-cell stat strip (Record / Hit rate / Edge).
    - The first 2 entries from `recentSettled(calls, 2)` with dashed separators, then Watch and Copy trade buttons.
  - **Copy trade** opens the stub below a dashed perforation that has half-circle notches at both edges:
    - "COPY TRADE @handle"
    - the stepper line
    - the Past week line
    - a full-width primary Copy trade button
  - **The copying state** replaces the old menu: the tilted green stamp, Change amount / Stop copying, and "See every copied pick in Portfolio.". Delete the old chips, custom input and menu.
  - Keep the Rescan button (from Task 12) and the "Open coPAYMe" footer link.
- [ ] **Step 4: Run the tests and confirm they pass.**
  Run: `pnpm --filter @copayme/extension test && pnpm --filter @copayme/extension typecheck && grep -rniE "simulat|real orders|no real money|copyMode" apps/extension/src apps/extension/entrypoints | grep -v test`
  Expected: tests and typecheck pass, and grep finds nothing.
- [ ] **Step 5: Check by hand on x.com, in light and dark mode.**
  - Open a badge's popover, open the stub, step the amount, confirm, and see the stamp. Then stop copying.
  - A 15-character handle and a score of 100 don't overflow.
  - It matches the "Extension copy ticket" and "Extension on dark X" (variant B) tabs.
- [ ] **Step 6: Commit.** `git commit -am "extension: style D popover with order-slip copy stub, rank, no copy-mode wording"`

---

### Task 14: Full verification and production build

**Files:** none new. Fix anything this task finds in the file that owns it.

- [ ] **Step 1: Run every test and typecheck.**
  Run: `pnpm -r test && pnpm -r typecheck`
  Expected: all PASS
- [ ] **Step 2: Run the banned-pattern sweep.**
  Run: `grep -rnE "●|ScoreRing|Gauge\b|linear-gradient|radial-gradient|blur\(|simulat|Real orders|No real money|PAPER MODE" apps/web/src apps/extension/src apps/extension/entrypoints | grep -v "\.test\."`
  Expected: no output. The only exception is the ticket's scalloped edges, which use `radial-gradient` for the perforation. Those lines must be in the ticket CSS only.
- [ ] **Step 3: Production build.**
  - Stop `pnpm dev:web`, then run `pnpm --filter @copayme/web build && pnpm --filter @copayme/extension build`. Expected: both succeed.
  - Restart `pnpm dev:web`.
- [ ] **Step 4: Screenshot pass.**
  - Website: `/`, `/leaderboard` (with a ticket open), `/traders/demo_sharp`, `/portfolio`, `/watchlist`, `/rewards` and `/how-scoring`, at 1440px wide and at 390px wide.
  - Expected: they match the mockups. On mobile, the podium stacks, the ticket's stub moves under the picks, and nothing scrolls horizontally.
- [ ] **Step 5: Commit any fixes.** `git commit -am "redesign: verification fixes"`
