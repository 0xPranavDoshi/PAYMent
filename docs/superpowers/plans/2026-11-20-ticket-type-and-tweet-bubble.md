# Ticket Receipt Type and Tweet Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tidy the website copy ticket into a two-size mono receipt, and draw the profile's expanded
tweet as a speech bubble.

**Architecture:** This is CSS plus small markup changes in `CopyTicket.tsx` and `PickRow.tsx`. The
mono font gets a monospaced fallback in `layout.tsx`. The shared TweetCard is not touched.

**Tech Stack:** Next.js 15, plain CSS (`globals.css`), next/font.

**Spec:** `docs/superpowers/specs/2026-11-20-ticket-type-and-tweet-bubble-design.md`

## Global Constraints

- Ticket text sizes: 13px (headings, rows, stub), 11px (column labels and fine print). Past week value: 20px bold mono.
- Column labels: MARKET, PRICE, RESULT, PER $1. No caption, no stub @handle, no dotted leaders.
- Mono font: `adjustFontFallback: false`, with fallback `ui-monospace, Menlo, monospace`.
- Bubble: 44px round avatar. A 2px ink outline with a 3px offset shadow and a squared top-left corner.
  Tweet text in Archivo 600 18px. Footer reads "We read this as {pick} · {price}" and "Open on X ↗".

## Review Focus

- A long tweet with links and line breaks: it wraps inside the bubble, links still work, and nothing overflows at phone width.
- A pick without a price (`price` is "YES"): the footer reads "We read this as Houston · YES".

---

### Task 1: Receipt ticket, tweet bubble, mono fallback

The web app has no component test setup (vitest covers `lib/` only), so verification is typecheck,
the existing tests, and a browser check on localhost.

- [ ] Step 1: `layout.tsx`: set the JetBrains_Mono options `adjustFontFallback: false` and `fallback: ["ui-monospace", "Menlo", "monospace"]`.
- [ ] Step 2: `CopyTicket.tsx`:
  - Drop the caption and the stub `<small>@handle`.
  - Rename the columns.
  - Remove the `.dots` spans.
- [ ] Step 3: `globals.css`: apply the ticket sizes above.
- [ ] Step 4: `PickRow.tsx`: replace `<TweetCard>` with the bubble markup, using `TweetText` and `formatTweetTime`. Add `.pk-bubble` CSS, including a phone-width rule.
- [ ] Step 5: Run `pnpm --filter @copayme/web typecheck && pnpm --filter @copayme/web test`, then check the Leaderboard ticket and the profile bubble in the browser.
- [ ] Step 6: Commit, push, open a PR and merge it (merge commit).
