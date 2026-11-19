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
  - *Pranav first chose a prompt-only fix.* The re-run showed Grok still flipping on "Tennessee to cover +3.5", so **the sign now lives in code** (Nov 18): Grok copies the line verbatim into `lineAsWritten` ("+3.5", "-7", "by 7"), and `spreadClaim()` reads the sign. Grok's `claim` is used only when there is no sign.
- **`temperature: 0`** on every Grok call. *Why:* the same tweet got different readings on different runs, because we had left the default randomness on.
- **`team_total` bet type**, always `no_market` (Gemini doesn't list team totals). *Why:* the schema had no slot for "Hawaii Team Total u17.5", so Grok squeezed it into `total` and it got matched to the game total.
- **Batches of 5 posts, 4 in flight at once.** *Why:* long write-ups crowd a 20-post batch, and running batches one after another made the scan slow.
- **`PIPELINE_VERSION` 3**, so stored posts are re-read with all of the above.
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

### Forwarding to scoring (off by default; updated Nov 18 after merging main)
- **Uses Aditya's live `POST /v1/posts` contract** (`packages/shared/src/ingest.ts`). The body is a `NewPost` or an array of up to 50. Each post carries `picks[]`, and every pick has `geminiEventTicker`, `instrumentSymbol`, `side` (YES/NO), `gameStartTime`, `resolutionSide` and `resolvedAt`. Auth is the `x-service-key` header.
- **Every matched pick is forwarded, with its side,** including spreads, totals and props. *Why the earlier limit to winner picks is gone:* `markets.outcomes` now stores `resolutionSide` per contract, so ladder markets can be settled per contract.
- **Markets are keyed by the event ticker** (`markets.gemini_market_id`), matching Yash's sync. The scout upserts each matched event before forwarding, because ingest skips picks whose market isn't in the table, and the sync only covers recent games. `lock_time` is the game's start time.
- **What counts as forwarded:** a post only when ingest stored it. A result carrying `error` is retried on the next scan. A pick is held back if its event can't be loaded or its market upsert fails.
- `oddsAtTweet` is always null: Gemini has no contract price history, so ingest prices picks itself.

### Keeping picks settleable and starting scans (Nov 18, after merging PR #33)
- **Market refresher** (`src/refresh.ts`; runs every `SCOUT_MARKET_REFRESH_S`, default 600 s, when forwarding is on).
  - What it does: re-fetches the markets behind forwarded picks whose game has started and whose `markets` row isn't settled, and upserts their per-contract `resolutionSide`. Cancelled (invalid) markets become `void`.
  - *Why:* the trading sync only refreshes the 200 most recent game-winner markets per sport. Spread, total and prop markets (and older games) would otherwise keep an empty result, and Aditya's worker could never settle those picks.
- **Extension profile-scan hook** (`apps/extension`, built with Aditya's OK).
  - Opening `x.com/<handle>` marks that handle's badges "Scanning…". The background worker POSTs to the scout, polls every 3 s for up to 90 s, then fetches the fresh badge from the scoring API and writes it to the badge cache.
  - Handles asked about in the last 10 minutes are skipped.
  - Config: `WXT_SCOUT_URL` (default `http://localhost:8789`), plus a matching host permission. Because of that permission the background worker isn't subject to CORS, so the scout needs no `SCOUT_ALLOWED_ORIGIN` for the extension.

### End-to-end forwarding test (Nov 18, Supabase, Pranav's OK)
- **Setup:** Aditya's API ran locally against Supabase with a throwaway service key and `TRADING_URL` blank (no watch or copy-trade notifications) and its worker paused. The scout ran with forwarding on.
- **Run 1:** 14 posts → 14 calls and 14 markets, with correct markets and sides. **Every call was unpriced** (`odds_source: none`): ingest only snapshots a price if the market was synced within 10 minutes of the tweet. The worker marked the 10 finished picks "scored", but with no points, so the score stayed 50 "New" with 0 resolved picks.
- **Fix: the scout prices picks at tweet time from Gemini candles** (`getYesPriceAt`). That's the close of the last 5-minute candle at or before the tweet (hourly as a fallback), or none if older than 6 hours, and `1 − YES` for NO picks. Sent as `oddsAtTweet`, so ingest records `odds_source: history`. Candles reach about 2 days back. My earlier "no price history" conclusion came from a single stale market.
- **Run 2:** I deleted only that test user's calls, posts and score, then re-forwarded. **Score 28, tier "scored", 5 resolved, 1 win:**

  | Pick | Price | Points |
  |---|---|---|
  | Edmonton | 0.47 | +0.53 |
  | Toronto | 0.39 | −0.39 |
  | Florida −15.5 | 0.46 | −0.46 |
  | Charlotte | 0.27 | −0.27 |
  | Chargers–Ravens under 39.5 | 0.50 | −0.50 |

  "UConn +3.5" is priced at 0.49 and still pending.
- **Still unpriced: 8 of 14** (contracts Gemini has no trades for: some spreads and props, Nets −2.5). These are excluded by Aditya's scoring, including a winning "Tennessee +3.5". Whether to count unpriced picks at an even 0.50 is a **team decision about scoring policy**.

### Pricing unpriced picks from Kalshi (Nov 18, Pranav's idea)
- **Why:** Gemini's price history (candles) only starts at a contract's first trade. In the Michigan State–Tennessee spread ladder, 15 of 20 lines had never traded, and our pick's line first traded 2.5 h *after* the tweet. A fair value existed, but Gemini keeps no quote history.
- **Kalshi mirrors Gemini's sports markets:** the same games, the same ladders and strikes (that game: 20 lines on both), and the same results. Kalshi is far more liquid, and its public 1-minute candles carry the **bid/ask even when nothing trades**.
- **Matching (`src/kalshi/match.ts`).** Kalshi tickers are never built from Gemini codes alone, because the codes differ (UConn: `UCONN` vs `CONN`, Arizona: `ARI` vs `ARIZ`, Ohio: `OHI` vs `OHIO`), home and away are sometimes swapped (`ND-FLA` vs "Florida vs Notre Dame"), and spellings differ ("Michigan State" vs "Michigan St.").
  - **Series** comes from the league and Gemini's bet classification: game / spread / total for NBA, NCAAM, NFL, NCAAF and NHL; NBA points, rebounds, assists and threes props; soccer game markets.
  - **Event:** first a guess from Gemini's codes, accepted only if the title's two teams match. Otherwise list the series (`min_close_ts` set to the game day, paged) and require the **same US-Eastern date plus the same two team names** (normalized, order-insensitive), with exactly one match.
  - **Market:** for spreads and props, the same team or player **and** the exact strike (`floor_strike`); for totals, the strike plus "over"; for winners, the team. Exactly one candidate, or no match.
  - **Safety net:** for settled markets, Kalshi's `result` must equal Gemini's `resolutionSide`, or the match is rejected.
- **Price (`src/kalshi/client.ts`):** the last 1-minute candle **ending at or before the tweet**, within the hour before it. Bid/ask midpoint if the spread is ≤ 0.10, else that minute's trade. Fallback: hourly candles over 6 h. Markets settled before `/historical/cutoff` (Sep 19) are read from `/historical/...`. 429s are retried with backoff (limit 20 reads/s per IP), and events and markets are cached for 5 minutes.
- **Order:** Gemini's own price first (the venue picks are tailed on), then Kalshi, then unpriced. Each pick's source is logged: `priced <symbol> <side> at <p> via gemini|kalshi (<ref>)`.
- **Live verification on the 14 e2e picks: 14 of 14 matched, 14 of 14 priced, 0 result disagreements.**
  - The 6 Gemini-code misses (UConn ×2, Florida–Notre Dame, Ohio, the Adebayo and Booker props) all match by name.
  - Where both exchanges have a price, Kalshi is within ~2¢ of Gemini (0.505/0.51, 0.385/0.39, 0.475/0.46, 0.275/0.27, 0.465/0.47, 0.495/0.47).
  - Neighbouring lines are never confused (MSU 3.5 → `MSU4`, not `MSU3`).
  - "Tennessee +3.5" is now priced at 0.535 (it won).
- **End-to-end re-run with Kalshi pricing (Nov 18, Supabase, test user's rows replaced again):**
  - **15 of 15 picks priced:** 7 via Gemini, 8 via Kalshi.
  - 14 calls: the account's two Spurs spreads on the same game collapse to one, under ingest's one-pick-per-market rule.
  - **Score 31, tier "scored", 11 resolved, 4 wins.** Run 2 had 5 resolved, and before pricing there were 0.
  - The three wins Kalshi pricing let count: Tennessee +3.5 (+0.465), Charlotte +8.5 (+0.455), Booker under (+0.405).
  - Losses priced via Kalshi: Nets −2.5, Ohio −10.5, Spurs −9.5.
  - 3 still pending on future games.

### Scoring right after forwarding (Nov 18)
- **Problem:** ingest stores new picks as pending, and only the scoring worker turns them into a score, on its own timer (every 5 min by default). The extension fetches the badge the moment a scan ends, so for a brand-new profile it got "no data" and cached that for **30 minutes** (`NEGATIVE_TTL_MS`). The score existed a few minutes later, but the badge stayed empty.
- **Fix:** after a forward that ingest accepted, the forwarder calls `POST /v1/worker/run` (same `x-service-key`) and waits for it, before the scan finishes. So the badge fetch at the end of the scan sees the score.
  - A 409 (run already in progress) is retried up to 4 times, 2 s apart.
  - Any failure is logged and ignored, so scoring falls back to the worker's schedule.
  - Nothing changes in the API or the extension.

### Re-scans only when the account posted something new (Nov 19)
- **Problem (measured in the Apify account):** a re-scan asks for tweets newer than the last one stored (`since_id`, at least 20 items). This actor **pads short results with placeholder items** (`{type,id,text}`, non-numeric id), and we pay for them at $0.00025 each.
  - A re-scan with **0** new tweets returned 15 placeholders and cost $0.0037.
  - So reopening a scanned profile every 10+ minutes cost ~0.4¢ each time for nothing. Grok was never called (it only gets unread posts).
- **Fix:**
  - **Extension:** after a profile opens, it waits (≤4 s) for that account's own tweets to render. It then sends the **largest tweet id by that handle** on the page as `POST /v1/scout/:handle?newest=<id>`.
    - Taking the maximum means a pinned (older) tweet doesn't matter, and retweets don't count (their author is the original poster).
    - The id comes from the link around the tweet's timestamp, not a quoted tweet's (`extractTweetId` / `newestTweetIdBy` in `apps/extension/src/selectors.ts`).
  - **Scout:** if that id is ≤ the stored `newestTweetId` (compared as BigInt), **Apify isn't called**.
    - If posts are still pending (game not listed yet, failed reads), it runs a scan with `fetchNew: false`. That re-matches them, costs nothing from X, and forwards and scores as usual.
    - Otherwise it answers 200 from cache.
  - **Fallback:** without a valid id, a known profile is re-fetched at most **once an hour** (was 10 min). With a newer id, the 10-minute rule still applies.
  - **`scannedAt` now means "last fetch from X":** a no-fetch scan leaves it unchanged (`finishScan({ fetched: false })`).
- **Failure modes:**
  - If X changes its markup and no id is found, the behaviour is the hourly fallback, never a missed scan.
  - A recent retweet can't trigger a fetch, but the next original post does, and the top-up then fetches everything since the last fetch.
- **Not verified live on x.com yet:** the timestamp-link selector is based on X's current markup and covered by unit tests only.

### @Pickswise test fixes (Nov 19)
Adi's first scan of @Pickswise: 98 posts, 18 predictions, 15 picks forwarded, score 64 (12 resolved, 7 wins). Three problems:
- **Badge never appeared:** the scan took ~2 min, but the extension stopped waiting after 90 s (`POLL_FOR_MS`) and showed nothing. Now 4 min.
  - Forwarding was 22 s of it (measured on the 14 posts against real Gemini/Kalshi). Posts are now priced 4 at a time, and Kalshi lookups in flight are shared.
  - The rest is Apify + Grok reading 98 posts; not yet split out (needs the scan's timing line).
- **A recap became a pick:** "Chargers 23, Ravens 20. Los Angeles gets its first win of 2026." Grok read it as "Chargers win" (0.85), and the matcher, finding no Chargers–Ravens game ahead, dropped the opponent and took the Chargers' next game (vs Jets).
  - **Prompt:** a final score or past-tense result is a recap. Tested on real Grok: 10/10 (3 recaps rejected, 7 real picks unchanged, including a 3-leg parlay).
  - **Code:** the opponent fallback only applies when the pick's own quote doesn't name the opponent (`namedIn` in `match/candidates.ts`). That's the case for Grok-invented parlay opponents; a recap names its opponent.
- **Wrong line (team decision, Pranav):** "Grambling St +37.5" matched the 40.5 line under the old nearest-implied-line rule. **Now only the exact line matches**; otherwise no match.
  - The one exception is a written "N+" ("30+ points"), the same bet as over N−0.5 for whole-number stats.
  - **Whole-number lines (team decision, Pranav):** these take the half-point line 0.5 away, since Gemini lists only half points. First choice is the line whose contract wins only when the bet wins, so a push counts as a loss: −7 → 7.5 YES; dog +7 → favourite's 6.5 NO; over 220 → 220.5; under 220 → 219.5. Otherwise the other neighbour; nothing further away.
  - **Gemini drops sub-markets at random:** the same `getEvent` request alternates between returning a game's spread/total markets and not (measured: 0, 0, then 26 markets on three straight calls). The single refetch let totals fail by luck. Now up to 5 fetches, 1 s apart.
  - **Dry run on all 98 stored @Pickswise posts** (re-read + re-match, nothing written), run twice:
    - recap and brag gone;
    - Grambling +37.5 dropped;
    - all spreads, totals and winners on their exact lines;
    - 3 picks that used to miss now match (Lakers −12.5, Western Michigan −14.5, Avalanche–Leafs over 6.5).
    - Grok called the Chargers recap a prediction in run 1 and not in run 2, so the prompt alone isn't reliable for it; the opponent check in code stopped it from matching both times.
    - West Virginia +9.5 and Florida −1.5 still came back without sub-markets after 5 tries; they stay pending and are retried each scan.
  - **Brags are recaps too:** "44 winning picks on Saturday ✅ Indiana -8.5, Iowa State -3, Heat +4.5, Sharks ML" had become two picks, Heat +4.5 on Miami's next game and Sharks ML. The Heat pick was unpriced because that market opened on Kalshi 6.4 h after the tweet. The prompt now names lists of past winners; real Grok rejects 3/3 brags and keeps 2/2 picks.
  - Stored rows made under the old rule: 4 of 27 line picks used a different line, all forwarded: Booker u23.5 → 24.5, total 44 → 44.5, Adebayo o17.5 → 14.5, Grambling +37.5 → 40.5.

## Open questions for the team (block turning forwarding on)
- ~~**Gemini environment**~~ **resolved on main:** market data reads production (`GEMINI_READ_BASE_URL`), and orders go to the sandbox.
- **Lock time: decided (Pranav, Nov 18). `markets.lock_time` = the market's `expiryDate`**, written the same way by the scout's upsert and by the trading sync (`apps/trading/src/sync.ts` `lockTimeFor`, changed in this branch).
  - *Context:* main's sync had switched to `effectiveDate`, believing it was the game start. Live data shows `effectiveDate` equals `createdAt`, the time the market was listed, about 2–3 days before the game. For example, UConn–Arizona was listed Nov 17 00:05, tips off Nov 19 02:00, and expires Nov 21 02:00. Locking on it would have rejected nearly every real pick as `after_lock`.
  - *Trade-off accepted:* with `expiryDate`, picks tweeted during or shortly after a game also pass ingest's lock check. Locking on `startTime` would stop that.
  - *Mitigation:* the scout's own matcher still treats tweets within 6 h after the game starts as "tweet during game", so it never turns them into picks.
  - Market rows already written by the old sync keep their `effectiveDate` lock until the sync runs again.
- ~~**Multiple picks per post, and a side field**~~ **resolved:** Aditya's ingest accepts `picks[]` with `side`.

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

- **Reading check after the v3 changes (Nov 18, 2 Grok calls, under 1¢): 9 of 9.**
  - Grok copied every sign verbatim: "+3.5" ×2, "+7", "+2.5", "-9.5", "-4", "-13.5". The code applied them.
  - "Bears getting 6.5" has no sign, so Grok's own `loses` was used.
  - "Hawaii Team Total u17.5" → `team_total` (no market), with no game total extracted.
  - The recap → not a prediction.

- **Supabase smoke test (Nov 18, a full first scan of @ActionNetworkHQ, forwarding off).**
  - The scout migration was applied through the team runner (`pnpm --filter @copayme/api db:migrate`), renamed `20261120120000_scout.sql` so it sorts after teammates' applied migrations. It only adds `scout_handles` and `scout_posts`.
  - **Duration 187 s** for 100 fetched → 71 kept. Still over the 90 s target. The likely cause is 15 Grok batches of the reasoning model (4 at a time) plus the Apify run; per-stage timing isn't logged yet.
  - **15 matched, all 15 correct when checked by hand.** Both underdog spreads are now right: "UConn +3.5" → "Arizona wins by more than 3.5" NO, and "Tennessee +3.5" → "Michigan State wins by more than 3.5" NO.
  - Also right:
    - "Charlotte +8.5" → "Los Angeles L wins by more than 8.5" NO.
    - "Booker Under 23.5" → "Booker 25+" NO.
    - "Adebayo o17.5" → "15+" YES.
    - Favourite spreads: Nets, Florida, Ohio, Spurs ×2.
    - Moneylines: Duke, Toronto, Charlotte, Edmonton.
  - 10 matched games had already settled (backfill) and 5 were open (tailing).
  - no_market: 3 "no contract guaranteed", 2 "no sub-event", 1 team total (correct), 1 "game returned without sub-markets" (left pending for retry, along with 2 others).

- **Speed and matching runs (Nov 18, Supabase, forwarding off, clean first scans of @ActionNetworkHQ).**
  - The timing line is now logged per scan.
  - **Run A (concurrency 8 read / 6 match):** 72.1 s. Fetch 18.0 s, read 30.5 s, match 18.3 s, save 5.3 s. 11 matched, all correct, but 4 picks regressed (below).
  - **Fixes after run A:**
    - (1) Grok named another parlay leg's team as the opponent (Spurs vs Hornets), so no game had both teams. The opponent is now a hint, with a fallback to the team alone.
    - (2) Spread contracts are labelled with the game title's short names ("San Antonio wins by more than 9.5"), which Grok's aliases miss. These are now added from the title ("Detroit vs San Antonio"), so no Grok fallback is needed.
    - (3) Gemini sometimes returns a game without its child markets, and settled games were cached forever. Incomplete games are now never cached and are refetched once.
  - **Run B (after the fixes, `PIPELINE_VERSION` 4):** 98.8 s. Fetch 18.3 s, **read 56.8 s** (Grok latency varies: same 71 posts as run A's 30.5 s), match 17.7 s, save 6.0 s.
    - **18 matched, 18 correct, 0 via the Grok fallback.** That includes the parlay (Spurs −8.5 YES, Charlotte +8.5 → "Los Angeles L by more than 8.5" NO), Spurs −9.5, Florida −15.5, Nets −2.5, and both underdog +3.5 spreads.
    - 2 pending retry: "Vice City −12.5" (a Heat nickname), and the Sensabaugh over, which has no line.
  - **Run C (read concurrency 12, failed batches logged, multi-row upsert): 57.8 s, under the 90 s poll window.** Fetch 18.2 s, read 29.0 s, match 9.9 s, **save 0.7 s** (was 6 s). No Grok batch was rejected.
    - The account's latest 100 tweets now had more retweets: 64 kept.
    - **14 matched, 14 correct.** That includes a new "Chargers vs Ravens UNDER 39.5" → "More than 39.5 points scored" NO.
    - Duke, Ohio and Buffalo fell outside the latest-100 window.
  - *Token cost:* parallelism doesn't change token use (same posts, same batches), only wait time. The one risk is xAI rate limits (a 429). A rejected batch is now logged, and its posts are re-read on the next scan. That re-read is the only way the parallelism can cost extra tokens.

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
