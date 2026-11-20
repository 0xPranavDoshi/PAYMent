# coPAYMe UI redesign: "Bold outline" (style D)

Date: 2026-11-19
Status: draft for approval (updated after builder review)
Visual references: [`2026-11-19-ui-redesign-mockups.html`](2026-11-19-ui-redesign-mockups.html) (leaderboard and ticket, extension, homepage, profile, portfolio, dark X) and [`2026-11-19-ui-redesign-mockups-rewards-how.html`](2026-11-19-ui-redesign-mockups-rewards-how.html) (Rewards, How it works). Open them in a browser and use the tabs. Where this doc and the mockup disagree, this doc wins.

## Why

The current website and extension look AI-generated:

- a score ring on every trader
- orange pill buttons
- a glowing gradient behind the leaderboard
- every block is a rounded dark card
- tiny all-caps labels everywhere
- gold, silver and bronze rows

The owner wants a UI that looks professional, deliberate and distinctive. It should be one visual language shared by the website (`apps/web`) and the extension (`apps/extension`).

## Goals

- Restyle every page of the website and every surface of the extension (badge, popover, profile scan card) in style D, described below.
- The website and extension read as one product: same tokens, same type, same components.
- Add a ticket-style **Copy trade** flow to the leaderboard and the extension popover.
- Redesign the portfolio P&L chart (chart A below).

## Non-goals

- No new backend features. The one exception is a small addition: the leaderboard response gains each trader's edge (see "Data"). A weekly spending cap was floated and **parked**.
- No website dark mode in this pass. The extension does need a dark variant for dark-mode X (see "Extension").
- No change to scoring or trading behavior.
- No profile photos. Avatars stay as initials.

## Anti-goals (these would be failures even if everything "works")

- Score rings or circular gauges anywhere.
- Status dots. No "● LIVE", no "● PAPER MODE", no round dot marking the end of a chart line. Text "·" separators are fine.
- Ambient gradients, glows, or blurred blobs.
- Any paper/live wording anywhere: no "simulate" or "simulated", no "No real money moves", no "Real orders" tag. Copy trades always look like real money. (This is a hackathon project, and the owner wants it to feel real.)
- Orange used as decoration. It's reserved for the brand mark, #1, and the single primary action in view.

## Approaches considered

Six directions were mocked up and compared on the homepage, a trader profile, and the extension popover:

| Direction | Summary | Outcome |
|---|---|---|
| A · Ledger | Editorial newspaper look: paper background, serif headlines, ruled tables | Not chosen |
| B · Terminal | Dense dark trading UI: mono numbers, amber accent, ticker | Not chosen |
| C · Exchange | Bright consumer fintech: white, cobalt, soft cards (Kalshi/Mercury) | Liked, but not chosen |
| **D · Bold outline** | Thick black outlines, solid offset shadows, graph-paper background, podium, orange accent. Based on a reference screenshot the owner supplied. | **Chosen** |
| E · Exchange + podium | D's layout in C's calm styling | Not chosen |

The owner picked D for its personality and confidence. C and E were the "safe" alternatives.

## Visual system

### Tokens

| Token | Value | Use |
|---|---|---|
| `bg` | `#F3F1EA` | Page background, with a 36px graph-paper grid of `rgba(17,17,17,.045)` lines |
| `card` | `#FBFAF6` | Raised cards (podium #2 and #3, popover) |
| `surface` | `#FFFFFF` | Tables, lists, inputs, #1 podium card |
| `ink` | `#111111` | Text, outlines, offset shadows |
| `ink-2` | `#55524B` | Secondary text |
| `ink-3` | `#8B877D` | Tertiary text, axis labels |
| `orange` | `#FF6A1F` | Brand mark, #1 rank, primary button |
| `win` / `win-soft` | `#14894B` / `#C9EFD6` | Wins, gains, "up" chips |
| `loss` / `loss-soft` | `#E0412D` / `#FBD5CF` | Losses, "down" chips |
| `amber` | `#E8A317` | Middle score band only |
| `ticket` | `#F6F2E6` | Ticket background |

Score bands, used everywhere a score shows a color: **green** at 60 and above, **amber** from 40 to 59, **red** below 40.

### Type

- **Archivo** (600–900) for UI text and headlines. Page titles are 900 weight, around 72px, with tight negative tracking.
- **JetBrains Mono** (500/700) for small labels, stats captions, ticker, ticket tables, dates and axis labels. Mono labels are uppercase with letter-spacing of about .08em.
- Load both with `next/font/google` on the website, replacing Geist. The extension bundles or links them as practical (see "Left to the builder").
- Numbers use tabular figures.

### Shape and depth

- Outlines: **2–2.5px solid ink**. Radius: 8–10px on buttons and chips, 14px on cards.
- Depth comes from a **solid offset shadow** with no blur: 3px on buttons, 4–6px on cards. Nothing uses blurred shadows.
- Pressed state: the element moves by the shadow offset and the shadow disappears.

### Core components

- **Score tile.** This replaces `ScoreRing` (web) and `Gauge` (popover). It's a square outlined tile with the score in Archivo 900 and a colored strip along the bottom in the score-band color. Sizes: about 46px in tables, about 128px on the profile header.
- **Buttons.**
  - Primary: orange fill with ink outline and offset shadow.
  - Secondary: white fill with the same outline and shadow.
  - Active toggle (e.g. "✓ Copying · $10"): ink fill with an orange offset shadow.
- **Chips.** Outlined, with green or red soft fills for up/down. A mono uppercase variant is used for prices, e.g. "YES 52¢".
- **Tag.** A small mono uppercase outlined label, e.g. "PENDING".
- **Stat strip.** One outlined card split into equal cells by ink rules. Each cell has a mono caption above a large Archivo number.
- **Hit-rate bar.** An outlined rounded track with an ink fill.

## Pages (website)

- **Nav.**
  - Logo: an outlined orange rounded square plus the "coPAYMe" wordmark.
  - Outlined search box, then plain nav links. The active link gets a thick underline.
  - Right side: an orange "Sign in" button, or an account pill (initial plus handle) when signed in.
- **Homepage.**
  - Big headline, with "scored" sitting on an orange skewed highlighter bar.
  - Lede, then two CTAs: "Add to Chrome" (primary) and "See the leaderboard".
  - On the right, a product shot: a tweet with the badge, the popover, and a small tilted green "+11¢ per pick" sticker.
  - A full-width **black ticker** of the latest picks, labeled `LIVE PICKS` in orange text with **no dot**. YES prices in light green, NO prices in light red.
  - Three numbered step cards.
  - "Top traders" (top 3, with Copy trade buttons) beside "Latest picks".
- **Leaderboard.**
  - Title, subtitle, and the filter segment control (All / Beating market / Rising / New).
  - A **podium** of the top 3: #2 left, #1 center and raised, #3 right. #1 has an orange rank, a +Δ chip, a sparkline and a Copy trade button. #2 and #3 show hit rate and edge in mono.
  - Then the **table** with these columns: #, score tile, trader (initials avatar plus handle, with "N picks" under it), 14 days, picks, hit rate (bar), edge, and action (a Copy trade button on every row). Row 1's button is primary. Others are secondary.
  - Copy trade on a row opens the **ticket** (below).
- **Trader profile.**
  - Header card: large score tile, huge handle, then chips for Δ14d and rank ("#1 of 7"), plus "Last pick … · View on X ↗". On the right, Copy trade (primary) and Watch.
  - A stat strip: Record (W green, L red), Hit rate, Edge per pick, Resolved.
  - Then **Picks**: date, event plus market type, price chip ("YES 52¢"), and a result chip ("WON +39¢", "LOST −47¢") or a PENDING tag.
  - **The score-over-time chart is removed.**
- **Portfolio.**
  - Title and subtitle. **No "PAPER MODE" sticker or banner.**
  - Stat strip: Total P&L, Return, Open trades, Settled W–L.
  - **P&L chart A** (below).
  - "Copy trading" list: score tile, handle, "$X per pick · N trades since …", P&L, and a "✓ Copying · $X" toggle.
  - "Trades" list: event, then a mono line ("@handle · YES · bought 52¢ · now 58¢"), an Open/Won/Lost chip, and P&L with "+x% on $y".
- **Rewards** (second mockup file).
  - Title "Rewards" and the subtitle "Earn USDC on Arc every time someone copies or tails one of your picks."
  - **Payout ticket** in the same ticket shape as Copy trade:
    - Left: "AVAILABLE TO CASH OUT", a huge amount with "USDC", and a "+$X this week" chip.
    - Right stub: the primary "Cash out to wallet" button and "to 0x…… on Arc".
    - When the user can't cash out yet, the stub shows the existing guidance text instead of the button.
  - Stat strip: Earned, Cashed out, Rewards (On in green, Off in grey), Wallet (shortened address).
  - Two columns:
    - Left, "Payout wallet": a Linked chip, the full address in a mono box, and Change wallet / Disconnect. The wallet picker list appears when no wallet is connected. Below a dashed divider, "Earn from your picks" with a **square-knob toggle** (no round knob) and a line explaining 2% per pick, 1¢ minimum.
    - Right, "Activity": a ledger with date, reason, a mono detail line, amount, and a "tx ↗" link. Reasons map from `EarningReason`: `copy_reward` shows as "Copy reward", `tail_reward` as "Tail reward", `redeem` as "Cashed out".
  - "How you earn": three cards (2%, 1¢, Any time).
  - The detail line under each activity row ("@x copied …") only appears if the data has it. Otherwise it's left out.
- **How it works** (second mockup file). The content stays the same as the current page. Each rule gets a numbered section with text on the left and a picture on the right:
  1. **Points per pick:** a black formula chip `points = outcome − price`, and $1-contract bars at 85¢ and 35¢ with WIN/LOSE chips.
  2. **Shrinking small samples:** square grids. 3 lucky wins plus 10 dashed phantom squares, compared with a 40-pick record plus 10 phantoms.
  3. **From points to a score:** the formula chip, and an SVG curve of `50 + 50·tanh(edge/0.15)` with tags at −15¢→12, 0→50, +15¢→88.
  4. **New traders:** a NEW badge, then "5 resolved picks", then a scored badge.
  5. **What counts:** outlined ✓/✕ rows.

  The hero headline has "beat the market" highlighted, with a row of section chips under it. The 14-day-arrow note becomes a black callout with an orange shadow at the end.
- **Watchlist, Sign in, Activity.** No separate mockups. Restyle them with the same components (stat strips, outlined lists, chips, buttons). Keep their current content and behavior.

### P&L chart A (portfolio)

- **Card header.**
  - Left: total P&L as a big green or red number, a return chip ("+12.1%"), and "on $X copied · last N days".
  - Right: an outlined segment control, 1W / 2W / 1M / All.
- **The line.** One bold ink line (about 3.5px) for the running total.
  - The area between the line and $0 is filled `win-soft` above zero and `loss-soft` below.
  - $0 is a solid ink line. The other gridlines are faint and dashed.
  - Dollar labels sit on the right in mono, and dates along the bottom in mono.
- **Latest value.** Marked with a **tag** (an outlined rounded box with a solid shadow, showing "+$4.82") above the line's end, joined by a short vertical tick. **No dot.**
- **Hover.** A dashed vertical crosshair plus an outlined tooltip with the date, that day's result, and the running total.

## Copy trade: the ticket

### On the leaderboard

Pressing Copy trade on a row puts that row's button in its pressed state ("Copy trade ▴") and opens a ticket directly under the row. Pressing it again closes the ticket. Only one ticket is open at a time.

- **Ticket shape:**
  - `ticket` background, with dashed ink tear lines on the top and bottom edges.
  - Scalloped, perforated left and right edges.
  - A vertical dashed divider between the main part and the stub, with half-circle notches where the divider meets the top and bottom edges.
- **Left side, "RECENT PICKS"** (mono heading, plus "price when posted · result per $1"):
  - The **3 most recent settled picks**, in a mono table with columns MARKET / POSTED AT / RESULT / EDGE.
  - Then "See all N picks →", which links to the profile.
- **Right stub, the order slip.** It has exactly three things:
  1. "COPY TRADE" heading with the handle.
  2. `Amount per pick ........ [ − | $10 | + ]`: a label, a dotted leader line, and an outlined stepper.
  3. `Past week ........ +$15.81`: what copying this trader at the chosen amount would have earned over the last 7 days, in dollars. It's green or red, and recalculates when the amount changes.
  4. The full-width primary **Copy trade** button.

  There's nothing else on the slip: no presets row, no pace or weekly-spend lines, and no fine print, including no paper/live mode line.
- **After confirming on the website:** the stub becomes the same green "Copying @handle" stamp as the extension, with Change amount and Stop copying. Change amount brings back the stepper and a "Save" button.

### Everywhere else on the website

There is **one shared ticket component** with two states: choosing, and copying. The old `CopyButton` (presets, custom amount box, menu) is retired.
- **Trader profile:** Copy trade opens the ticket directly under the header card.
- **Homepage "Top traders":** Copy trade opens the ticket under that row.
- **Watchlist:** Copy trade opens the ticket under that row.
- **Portfolio:** "✓ Copying · $X" opens the ticket in its copying state.
- **Podium #1:** Copy trade opens the ticket under row 1 of the table.

### In the extension popover

The popover's Copy trade opens the same slip as a stub torn off the bottom of the popover: a dashed perforation across the popover with half-circle notches at both edges, then the same three lines and the button.

After confirming, the stub shows a tilted green **"Copying @handle"** stamp ("$10 PER PICK · SINCE NOV 19"), plus **Change amount** and **Stop copying** (red text) buttons, plus "See every copied pick in Portfolio."

This replaces the current preset chips, custom-amount panel and menu.

### Past-week calculation

- **Data source:** `GET /v1/users/:handle/calls`, fetched when the ticket opens.
- **Which picks count:** settled picks (`result` is "won" or "lost", `oddsAtCall` not null) whose `tweetedAt` is within the last 7 days.
- **Per pick, at amount A:**
  - a win earns `A × (1/oddsAtCall − 1)`
  - a loss earns `−A`
  - voids and unpriced picks earn nothing
- **No qualifying picks:** show "—" instead of $0.
- The endpoint returns at most 50 calls. Request `limit=50`. A trader with more than 50 picks in a week shows a slight undercount, which is accepted.
- The "RECENT PICKS" rows come from the same response.

### Stepper values

The stepper moves through `$1, $5, $10, $25, $50, $100` and defaults to $10, matching the current `DEFAULT_COPY_AMOUNT`. When already copying, it starts at the current amount. If that amount isn't in the list, it snaps to the nearest step.

## Data

What the mockups show compared with what the API has:
- **Sports line ("NFL · NBA") and market type ("Point spread"):** not in the data. **Dropped.** Where the mockup shows them, show the pick label instead (e.g. "Chiefs −2.5"), or nothing.
- **"Top 5%":** can't be calculated. **Replaced by rank, "#1 of N"**, taken from the leaderboard position (N is the leaderboard length). If the trader isn't on the leaderboard, show nothing.
- **Edge on the leaderboard:** `LeaderboardEntry` doesn't include `skill` today. **Add it** to the leaderboard response in `packages/shared/src/leaderboard.ts` and the API's leaderboard query. Then the Edge column and the "Beating market" filter (edge > 0) work. This is the only backend change.
- **Podium #1 sparkline:** fetch `/v1/users/:handle/score-history` for #1 only.
- **"Add to Chrome":** there's no store listing yet, so it stays disabled, labeled "Coming soon", like today's `ExtensionPromo`.

## Copy mode

The paper/live distinction disappears from the UI entirely:
- **Website:** remove the portfolio subtitle variants, the "Simulated" / "Real orders" tag in `TradeButtons.tsx`, and the explanatory panel text. Also remove the footer's "Copy trades are simulated." The footer keeps only "Scores are measured against market odds."
- **Extension:** remove the "This is simulated…" / "This places real orders" copy in `Popover.tsx`, and update the test that asserts it (`popover.test.tsx` around lines 571–583).
- **Backend:** the trading service's paper/live behavior stays as it is. Fetching the copy mode (`fetchCopyMode`, `copyMode()`) can be removed wherever its only use was that wording.

## Extension

- **Shared look.** The badge, popover, scan card and profile-header pill all use style D tokens. They stay inside shadow roots, as today in `apps/extension/src/styles.ts`.
- **Badge.** A white outlined chip with a 2px offset shadow. It contains the orange mark square, the score, and the green or red Δ.
- **Popover.**
  - Header: handle and "N resolved · #R of N", with the big score on the right.
  - A three-cell stat strip: Record / Hit rate / Edge.
  - 2 recent picks, with dashed separators between them.
  - Watch and Copy trade buttons.
  - Copy trade opens the stub described above.
  - The **Rescan** button (added on Nov 19, in `Popover.tsx` via `onRescan`) is restyled as a secondary outlined button. Its behavior is unchanged.
- **Dark-mode X uses variant B.**
  - Cards and badge: `#161616` fill with `#F3F1EA` (cream) outlines and an **orange** offset shadow.
  - Win and loss text: `#6EE59C` and `#FF8A78` for contrast.
  - Primary button: orange fill.
  - This hooks into the existing theme detection (`detectTheme` / `data-theme` on the shadow host).
  - Light-mode X uses the light style D.

## Constraints

- **Stack.** The website is Next.js 15 (App Router) with plain CSS in `apps/web/src/app/globals.css` and no CSS framework. The extension is WXT plus React, with CSS strings injected into shadow roots. Keep these approaches. Don't add Tailwind or a component library.
- **Shared tweet card.** `@copayme/tweet-card` is shared by both apps. Its tweet rendering must keep looking like X's own tweets.
- **Tests.** The existing extension tests (`popover.test.tsx`, `page.test.tsx`, `brand.test.tsx` and others) cover behavior. Update them for the new markup and the copy flow, and don't lose any behavior coverage.
- **Copy flow behavior.** The extension's start/stop/change-amount calls go through `trading.ts`. The flow's behavior stays the same. Only its UI changes.

## Left to the builder

- **CSS layout.** How to split `globals.css` (one file, or per-component files) and how to share tokens between the web CSS and the extension's CSS strings. A single exported token module in a shared package is a reasonable choice.
- **Fonts in the extension.** Whether to bundle Archivo and JetBrains Mono into the extension or fall back to system fonts there. The look must hold up either way.
- **Small adjustments.** Exact spacing, responsive breakpoints, and the mobile layout. On mobile, the podium stacks and the ticket's stub moves under the picks.
- **Animation.** Keep it minimal: the pressed-button shift, and the ticket opening by height. Respect `prefers-reduced-motion`.
- **Order of work.** Tokens and components first, then the pages, then the extension is a sensible order.
