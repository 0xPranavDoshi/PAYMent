# Website: tidy receipt ticket and speech-bubble tweet

**Status:** proposed, 2026-11-20. A small change to the website (`apps/web`).

## Why

The copy-trade ticket felt noisy: 9 font sizes, all-caps headings, dashed rules, dotted leaders and a
caption line. The expanded "See tweet" on a trader's profile felt plain and empty. The user compared
the options in mockups and picked ticket **B · Tidy receipt** and tweet **C · Speech bubble**.

## Approaches considered

- Ticket: A · Clean sans (all Archivo, 3 sizes) or **B · Tidy receipt (chosen)**.
- Tweet: A · Pull quote, B · Tweet + slip, or **C · Speech bubble (chosen)**.

## Design

### Ticket (the CopyTicket on Leaderboard, Watchlist and profile)

- **Typeface:** monospaced throughout, at two sizes only.
  - 13px for headings, rows and stub text.
  - 11px for column labels.
  - The stepper's amount and the Copy trade button stay as they are.
- **Headings:** "RECENT PICKS" and "COPY TRADE" in 13px bold with letter spacing. The caption
  "price when posted · result per $1" is removed.
- **Column labels** are renamed MARKET, PRICE, RESULT, PER $1, in 11px bold `--ink-3`.
- **Rows:** 13px with 1px dashed faint separators. The last column is bold and green or red.
- **Stub:**
  - The repeated @handle is removed.
  - "Amount per pick" and "Past week" are plain label-and-value rows, with no dotted leaders.
  - The 2px solid rule stays above Past week, with the value in 20px bold mono.
- **"See all N picks →":** 12px bold mono, underlined.
- **Font loading fix (my call):** the mono font's automatic fallback is currently a size-adjusted
  Arial, which is why the user saw a sans ticket. Turn that fallback off and list `ui-monospace`,
  `Menlo` and `monospace` next, so the ticket stays monospaced even before or without the web font.

### Expanded tweet (PickRow on `/traders/[handle]`)

- **Layout:** a circular avatar (44px, ink outline, initial) beside an outlined bubble.
  - The bubble has a 2px ink outline, a white background and a 3px offset shadow.
  - Its top-left corner is squared, so it reads as coming from the avatar.
- **Inside the bubble:**
  - **Head:** **@handle** · full time ("11:19 PM · Nov 19, 2026"), 13px.
  - **Text:** the tweet in Archivo 600 18px, with links kept.
  - **Footer:** "We read this as {pick} · {price}" in 13px `--ink-2`, then "Open on X ↗" in bold ink.
- **Website only:** the bubble is drawn in the website's PickRow and reuses the shared tweet-text and
  time helpers. The shared TweetCard and the extension popover's tweet are unchanged.

## Left to the builder

Exact CSS, and keeping the CopyTicket and PickRow tests green.
