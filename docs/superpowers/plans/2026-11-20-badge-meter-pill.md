# Badge Meter Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the x.com handle badge with the meter pill.

**Architecture:** `badgeView` stops returning a change arrow and instead returns a `meter` (fill
percent and score band) for scored traders. `Badge.tsx` drops the mark and the arrow and draws the
meter. `BADGE_CSS` restyles `.pill` as a 20px rounded pill.

**Tech Stack:** React, WXT content script, vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-20-badge-meter-pill-design.md`

## Global Constraints

- Pill: 20px tall, fully rounded, 1.5px ink outline, white (`--surface`) background, no shadow.
- Meter: 26×6px, 1.5px ink outline, filled to `score%` in the band colour (win ≥60, amber 40–59, loss <40).
- No mark, no offset shadow and no 14-day arrow on the badge.
- Non-scored states: dashed outline, mono 10px text in `--ink-2`, no meter. Failed: `--loss` outline and text.
- Click, title and aria behaviour unchanged. Always light.

## Review Focus

- Score 0 → an empty meter, still red. Score 100 → a full meter. Pinned in the badgeView tests.
- Score exactly 60 or 40 → the band boundary follows `scoreBand`. Pinned in the badgeView tests.

---

### Task 1: Meter pill

**Files:**
- Modify: `apps/extension/src/badgeView.ts`, `apps/extension/src/Badge.tsx`, `apps/extension/src/styles.ts` (BADGE_CSS)
- Test: `apps/extension/src/badgeView.test.ts`, `apps/extension/src/page.test.tsx`

**Interfaces:**
- Produces: `BadgeView.meter: { pct: number; band: ScoreBand } | null`, replacing `arrow`.

- [ ] Step 1: Update the badgeView tests.
  - Scored 72 → `meter: { pct: 72, band: "win" }`.
  - 60 → win, 59 → amber, 40 → amber, 39 → loss.
  - 0 → `{ pct: 0, band: "loss" }`, 100 → `{ pct: 100, band: "win" }`.
  - Every non-scored state → `meter: null`.
- [ ] Step 2: Update the page tests.
  - The badge text "72▲8" becomes "72".
  - The scored pill holds `.meter` with `--v: 72%` and class `win`.
  - It has no `svg`.
- [ ] Step 3: Run `pnpm --filter @copayme/extension test`. Expect it to fail.
- [ ] Step 4: Implement the badgeView, Badge.tsx and BADGE_CSS changes. Run the tests, then `tsc --noEmit`. Expect both to pass.
- [ ] Step 5: Commit, push, open a PR and merge it (merge commit).
