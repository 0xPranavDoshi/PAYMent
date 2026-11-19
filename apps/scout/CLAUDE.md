# apps/scout — Grok pipeline: working log

Owner: Pranav. Spec: `docs/design/grok-pipeline.md`. Plan: `docs/superpowers/plans/2026-11-18-grok-pipeline.md`.
This file is the running log for the scout service: current status, every design decision with its reasoning, and test results. **Update it whenever a decision changes or a test runs.**

## What it does

Given an X handle, the service fetches the account's latest posts, uses Grok to find sports predictions, and maps each one to a Gemini Predictions contract and a YES/NO side. It caches everything in Postgres, and can optionally forward picks to the scoring API.

```
POST /v1/scout/:handle → fetch (Apify) → dedupe → read (Grok) → find game (Gemini, code)
                       → choose contract (code; Grok only as a name-matching fallback)
                       → store (scout_handles, scout_posts) → forward (off by default)
GET  /v1/scout/:handle → { status, scannedAt, results[] }
```

Run it locally with `pnpm dev:scout` (port 8789). It needs `DATABASE_URL`, `APIFY_TOKEN` and `XAI_API_KEY` in the repo-root `.env`.

## Status (Nov 18, 2026)

- **Built:** all 9 plan tasks plus the final-review fix wave, on branch `worktree-grok-pipeline`. Every task was reviewed, and the whole branch was reviewed once at the end.
- **Tests:** 175 scout tests pass, including the Postgres suite. The shared and api tests pass, and the typecheck is clean.
- **Forwarding to scoring:** OFF (`SCOUT_FORWARD_ENABLED=false`) until the team questions below are settled.
- **Accuracy check:** not run yet. `eval/labelled.json` is empty and needs about 30 hand-labelled tweets.
- **Live smoke test:** in progress. See Test results.

## Design decisions and reasoning

### Scope and inputs
- **Open and closed markets.** Closed (settled) games backfill reputation scores. Open games power tailing. *(Pranav)*
- **Sports only:** wins, spreads, totals and player props. *(Pranav)*
- **On demand, per handle, cached in the database.** The first request backfills; later requests return cached results plus new posts. *(Pranav)*
- **A scan starts only when someone opens a profile** (the extension hook belongs to Aditya), not for every handle seen in the timeline. This keeps cost bounded. *(Pranav)*
- **At most the last 100 posts per first scan, and 20 per top-up.** This is a hard cap in code (`apify.ts`), because the scraper treats `maxItems` as a target and can return extras. *(Pranav, Nov 18)*

### Getting posts
- **Server-side Apify scraper** (`kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest`, about $0.25 per 1,000 tweets, covered by the $5 free credit).
  - The official X API was rejected: paid, with no free tier since Feb 2026.
  - Grok's built-in X search was rejected: it's a search, so it can miss posts.
  - The extension reading x.com was rejected: Pranav wants this server-side.
  - Self-hosted scrapers (twscrape, twikit) were rejected: they need real X account cookies, which risks lockouts.
- **The more popular `apidojo/tweet-scraper` was rejected:** the free plan can't call it through the API.
- **Scraper input:** `searchTerms: ["from:<handle>"]` plus `since_id:<id>` on top-ups, `queryType: "Latest"` (the actor has no `sort` field), and `maxItems` of at least 20 (the actor's minimum). The token goes in an `Authorization` header, never in the URL.
- **Tweet time is decoded from the tweet ID** (snowflake), not taken from the scraper's date string. That keeps the 7-day rule exact. A warning is logged if the two differ by more than 60 s.
- **Retweets are dropped** (they're not the person's own call). Replies and quote tweets are kept.

### Reading posts (Grok)
- **Model `grok-4-1-fast-reasoning`, strict `json_schema` output,** validated with Zod. Invalid output gets one retry, and a network error or 60 s timeout counts as a failed attempt.
- **Batches of 20 posts per call.** A post counts as a prediction only if `isPrediction && confidence >= 0.7`.
- **The prompt judges each post as of its own `createdAt`,** so old tweets about games that have since been played still count (needed for backfill).
- **Spread direction is decided by the sign, step by step in the prompt** (Nov 18, revised after the smoke test). `line` is always positive. A "+" before the number means the team is the underdog: claim `loses`. A "-" means the favourite: claim `covers`. The wording only counts when there is no sign. The prompt says outright that "cover" is used for both sides ("Tennessee to cover +3.5" is an underdog bet), and includes that real tweet as an example.
  - *Why:* the first version listed "X covers L → covers". Grok matched the word "cover" and ignored the "+", so 2 of the 14 smoke-test matches were wrong.
  - *Pranav chose a prompt-only fix* over a code check on a copied signed line (the alternative considered: Grok copies `"+3.5"` verbatim and code applies the sign). Revisit if the accuracy check finds sign errors again.
- **Post text is treated as data, not instructions** (prompt-injection safety). Grok can never invent a market: it only extracts claims, and code chooses the contracts.

### Matching (code owns timing and contract choice)
- **Time window:** the game must start after the tweet and no more than 7 days later; the earliest such game wins. *(Pranav)*
- **In-game tweets** (up to 6 h after a matching game starts) get `no_market` "tweet during game" instead of being moved onto the next game.
- **Gemini search** matches titles only, is sorted oldest first, and is paged with `offset` (capped at 10 pages). It covers the `active`, `settled` and `under_review` statuses. The settled-only list without search stops around 4 days back, which is why we search by team name.
- **Team matching:** exact name or abbreviation beats whole-word containment ("Arizona" won't pick Arizona State over an exact Wildcats match). A tie between two teams gives no match. A `league` hint restricts candidates to that league's ticker prefix.
- **Line rule** (code, from each contract's `strike`): over/covers/"L+" → largest line ≤ L, YES. Under → smallest line ≥ L, NO. Underdog +L → the opponent's spread, smallest line ≥ L, NO. No number → `no_market`. Example: "Lakers by 7" with lines 1.5/4.5/7.5 → "more than 4.5", YES. This guarantees we never score someone on a stronger claim than they made.
- **Full-game markets only:** first-half spreads and totals (`scope: half`) are ignored.
- **Grok fallback** runs only when no contract's label or abbreviation matches the team or player name. Grok must answer from an enum of real contract symbols. Matches made this way are marked "(via grok)", and the fallback returns nothing if it names more than one team.
- **Retries:** "No game within 7 days" for a tweet less than 8 days old is retried on later scans (Gemini may list the game late). Rows from an older `PIPELINE_VERSION` are re-read and re-matched.

### Storage and API
- **Tables:** `scout_handles` (per-handle state plus an atomic lock that goes stale after 5 min) and `scout_posts` (every post and its AI output, including non-predictions, so nothing is read by Grok twice).
- **Freshness:** a handle scanned less than 10 min ago is served from cache. New handles are capped at 30 per day (`SCOUT_DAILY_NEW_HANDLES`); top-ups don't count.
- **Hosting:** an always-on Node process (Railway), because scans run in the background in-process.

### Forwarding to scoring (off by default)
- **Uses the existing `NewPost` from `packages/shared/src/trading.ts`:** one pick per post, with no side field.
- **Only game-winner picks are forwarded.** Spread, total and prop markets are ladders where several lines resolve YES at once, but `markets.winning_outcome` holds one label. Forwarding them would score correct picks as losses.
- **"Team loses"** is sent as the opponent's label on 2-outcome games. Other NO picks stay in `scout_posts`.
- **The scout upserts matched games into `markets` before forwarding,** because `posts.gemini_market_id` is a foreign key and Yash's sync only covers recent events. `lock_time` is the game's start time.

## Open questions for the team (block turning forwarding on)
- **Gemini environment:** scout reads production Gemini, but Yash's market sync may use the sandbox. IDs can collide in `markets`. Pick one environment.
- **Lock time:** Yash's sync sets `lock_time = expiryDate` (about 2 days after the game), and scoring uses it as the lock time. Picks tweeted mid-game would count. It should be `startTime`.
- **Backfilled calls have no price history:** how does Aditya's ingest score picks on settled games (odds at tweet time)?
- **Multiple picks per post, and a side field:** needed to forward spread/total/prop picks. This is Aditya's `NewPost` contract.

## Test results

- **Unit and integration (Nov 18):** shared 20 passed; api 16 passed, 4 skipped; scout 161 passed, 14 skipped without a database, and 175 passed against local Postgres. Typecheck clean.
- **Live spike (Nov 18, under 1¢):**
  - Apify returned 20 real `@espn` tweets, and our normalizer read all 20. The field names match.
  - xAI accepted the model and strict `json_schema` output.
  - Grok found 2 picks in "Lakers by 7 tonight… LeBron 30+", and correctly rejected "Celtics won by 12" as a recap.
- **Live Gemini checks (free):**
  - Settled search for "Lakers" returned 39 events, oldest first, back to April.
  - "buffalo" returned 459 settled events (city name; includes sub-markets).
  - `under_review` is a valid status.
  - First-half markets have `scope: half`.
- **End-to-end smoke test (Nov 18):** one live scan of `@ActionNetworkHQ` against a throwaway local Postgres, with forwarding off. It finished `idle` with no errors.
  - **Duration: 12 min 28 s** (target: under 90 s). Nearly all of it was Gemini lookups made one at a time. Broad aliases (e.g. "buffalo": 459 settled events) are paged in full for every alias × status.
  - **Posts:** 68 stored. That's 100 fetched minus retweets, and the cap held. None were left unread; 18 counted as predictions (≥ 0.7 confidence).
  - **Matches:** 14 matched, 8 `no_market`. The no_market reasons were 4 "no sub-event for bet type" (e.g. team totals, which Gemini doesn't list), 2 "no game within 7 days" and 2 "no contract guaranteed by the claim". 1 post is pending retry after a transient Gemini error ("unparseable body"; every page passes our schema on re-check).
  - **Correctness, checked by hand: 12 of 14 right.**
    - Right: moneylines (Duke, Toronto, Charlotte, Edmonton), favourite spreads (Nets −2.5, Florida −15.5, Ohio −10.5, Spurs −9.5, UConn −13.5 → 12.5), and props on the closest guaranteed line (Adebayo o17.5 → "15+", Huerter → "10+").
    - Wrong (2): underdog spreads "UConn +3.5" and "Tennessee +3.5" both became "team wins by more than X, YES". Grok returned `claim: "covers"` because bettors say "cover +3.5", despite the prompt rule. Fix planned: a code guard on the quote's `+` sign.
  - Backfill works: 9 of the 14 matches are on games that have already settled. Live picks work: 5 are on open games.
  - Cost: about 100 tweets on Apify (about 2.5¢) plus about 5 Grok read calls and 2 fallback calls.

- **Spread prompt test (Nov 18, 1 Grok call, under 1¢), after the prompt rewrite: 8 of 8 read correctly.**
  - The 2 smoke-test failures: "UCONN +3.5" → UConn (returned as "Connecticut Huskies") loses 3.5, and "Tennessee to cover +3.5" → loses 3.5.
  - 5 unseen phrasings: "Iowa +7", "Bears getting 6.5", "Purdue +2.5 covers easy" → loses; "Gonzaga to cover -9.5" and "Celtics -4" → covers.
  - 1 recap → not a prediction.
  - Single run only. Grok is not deterministic, so confirm with the accuracy check.
  - Not checked: Grok named UConn "Connecticut Huskies". Its aliases must still include "UConn" for Gemini's title search; check on the next live scan.

- **Gemini API review (Nov 18, free).** I read the OpenAPI spec, the sports ticker guide and the market taxonomy guide, and probed live.
  - List Events has no date, team or sort filter. It does have `sport`, `sports_market_type`, `sports_market_scope`, repeatable `status` (`approved`/`active`/`under_review`/`settled`) and `limit` up to 500.
  - **Undocumented:** `search` also matches tickers (`NCAAM-2611190200-UCONN-ARI-M`). So `NBA-261118` returns that day's NBA games (5), and `-LAL-` returns exactly 22 Lakers games.
  - Searching by title has problems: "Lakers" also matches the Mercyhurst Lakers, and "Los Angeles Lakers" matches nothing, because titles say "Los Angeles L".
  - League codes in tickers: NCAAM, NFL, NCAAF, NBA, NHL, UCL, EPL, LALIGA, LIGAMX.
  - Still no contract price history (candles exist only for crypto indexes).
- **Smoke test re-run (Nov 18, after the league + day search and sign prompt; v2 re-read of the stored posts plus a top-up of up to 20 tweets).**
  - **Duration: 203 s**, down from 748 s. Most of what's left is probably the 4 Grok read batches running one after another (not measured yet).
  - 71 posts, all re-read at v2. 14 matched, 9 no_market.
  - Fixed: "UConn +3.5" → "Arizona wins by more than 3.5" NO. "Charlotte +8.5" (from a parlay) → "Los Angeles L wins by more than 8.5" NO.
  - Still wrong or missed:
    - (a) "Tennessee to cover +3.5": Grok said `covers` again on this read, so the prompt-only fix holds only some of the time.
    - (b) "Hawaii Warriors Team Total u17.5" was matched to the *game* total ("More than 22.5 points scored" NO). Team totals aren't game totals.
    - (c) Tennessee got "no sub-event for bet type", but re-running `findGame` now returns the right game with its spread. Gemini apparently returned the game without child markets once, and we stored that as final.
    - (d) "Kevin Huerter o10.5": Grok gave the wrong team (Kings), so no prop was found.

## Changes in progress / next
- [x] **Underdog spreads:** fixed in the prompt (sign decides), verified 8 of 8 on a live test. The fallback, if errors come back, is a code check on a verbatim signed line from Grok.
- [ ] **Speed up Gemini lookups** (smoke test: 12.5 min):
  - Read only the pages covering the tweet date (results are oldest first: jump to the end and page backward).
  - Skip broad city aliases when a specific name or abbreviation exists.
  - Run the searches for each prediction in parallel (3–5 at a time).
- [x] Smoke test done; results recorded above.
- [ ] Fill `eval/labelled.json` and run `pnpm --filter @copayme/scout eval` (target: win accuracy ≥ 80%).
- [ ] Pre-warm the demo handles (`pnpm --filter @copayme/scout prewarm <handles…>`) once the accuracy check passes.

## Spending log
- Apify: spike, 20 tweets (about $0.005). Smoke test, up to 100 tweets (about $0.025).
- xAI: spike, 1 call. Smoke test, up to 5 read calls plus a few fallback calls (a few cents at most).
