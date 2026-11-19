# coPAYMe — Full Product TDD

Yash Bapat · Nov 18, 2026

## Product summary

coPAYMe is an autopilot for Gemini Predictions. The core loop:
1. Chrome extension shows a **score badge** next to X handles — how good is this person at calling sports predictions?
2. Clicking the badge opens a **popover** where you can **Watch** (track $1 paper PnL per pick) or **Copy Trade** (auto-place real Gemini orders every time they post a pick).
3. A **website** shows the leaderboard, your watchlist with paper PnL, and your trading activity from people you copy-trade.
4. The extension links directly to the website.

---

## Current state (what's already built)

| Component | What exists | Key file(s) |
|---|---|---|
| Score badge chip | ✅ Renders next to tweet authors via MutationObserver | `apps/extension/entrypoints/content.tsx` |
| Badge API | ✅ Batch handle lookup with TTL cache | `apps/api` |
| User profile API | ✅ `GET /v1/users/:handle` | `apps/api/src/app.ts:100` |
| Scoring engine | ✅ Beat-the-market skill formula | `packages/shared/src/scoring.ts` |
| Market sync | ✅ Pulls sports events from Gemini production | `apps/trading/src/sync.ts` |
| Manual tails | ✅ Paper + live orders with slippage check | `apps/trading/src/app.ts` |
| Tail status + P&L | ✅ `GET /v1/tails/:id` + per-contract resolutionSide | `apps/trading/src/app.ts:183` |
| Portfolio | ✅ `GET /v1/users/:userId/tails` | `apps/trading/src/app.ts:206` |
| Schema | ✅ users, user_scores, markets, calls, tails, score_snapshots | `supabase/migrations/` |
| Migration runner | ✅ Checksum-verified, advisory-locked | `apps/api/src/db/migrate.ts` |

**What is not yet built:** Watch, Copy Trade, website, popover in extension, profile-page overlay, leaderboard endpoint.

---

## Target architecture

```
x.com feed/profile
       │
  [Extension content script]
       │  badge click → popover (Watch / Copy Trade)
       │  profile page → header overlay (Watch / Copy Trade)
       │  "Open coPAYMe" link
       ▼
  [apps/web] Next.js website
   /leaderboard   (public, SSR)
   /traders/:h    (public, SSR)
   /watchlist     (auth required)
   /activity      (auth required)
       │                    │
       │ GET /v1/leaderboard│ POST /v1/watches
       │ GET /v1/users/:h   │ POST /v1/copy-trades
       ▼                    ▼
  [apps/api]          [apps/trading]
  scoring API         trading service
       │                    │
       └──────────┬─────────┘
                  ▼
            Supabase Postgres
```

---

## What changes / breaks vs current code

### Does NOT break

- Existing badge chips on feeds — entirely additive changes
- `GET /v1/badges`, `GET /v1/users/:handle`, all existing trading endpoints
- Scoring engine math
- Market sync and tail placement

### Needs to extend (not rewrite)

| File | Change needed |
|---|---|
| `apps/extension/src/Badge.tsx` | Add click handler → popover with Watch/CopyTrade buttons |
| `apps/extension/wxt.config.ts` | Add trading service origin to `host_permissions`; add `WXT_TRADING_URL` env |
| `apps/extension/src/config.ts` | Add `TRADING_URL` |
| `apps/extension/src/api.ts` | Add `watchTrader()`, `copyTradeTrader()`, `unwatchTrader()` |
| `apps/api/src/store.ts` + `store.postgres.ts` | Add `leaderboard(limit)` method |
| `apps/api/src/app.ts` | Add `GET /v1/leaderboard` |
| `apps/trading/src/app.ts` | Add Watch + CopyTrade CRUD endpoints; add copy-trigger endpoint |
| `apps/trading/src/store.ts` + `store.postgres.ts` | Add watch/copy-trade read/write |
| `packages/shared/src/trading.ts` | Add `WatchResponse`, `CopyTradeConfig` Zod types |
| `tails` table | Add `source text check in ('manual','watch','copy')` column via migration |

### Net-new

| Item | Description |
|---|---|
| `supabase/migrations/20261120000000_watches_copy_trades.sql` | `watches`, `copy_trades` tables + `tails.source` column |
| `apps/extension/entrypoints/profile.tsx` | New content script matched to `/[A-Za-z0-9_]{1,15}` profile URLs |
| `apps/web/` | Next.js website (leaderboard, watchlist, activity) |

---

## Schema additions

### `watches` table

```sql
create table watches (
  id              uuid        primary key default gen_random_uuid(),
  follower_id     uuid        not null references users(id) on delete cascade,
  trader_x_handle text        not null,
  created_at      timestamptz not null default now(),
  constraint watches_uniq unique (follower_id, trader_x_handle)
);
create index watches_follower_idx on watches (follower_id);
```

**What it does:** one row per follower-trader pair. The trading service auto-creates a $1 paper tail whenever a new call is promoted for `trader_x_handle`.

### `copy_trades` table

```sql
create table copy_trades (
  id              uuid         primary key default gen_random_uuid(),
  follower_id     uuid         not null references users(id) on delete cascade,
  trader_x_handle text         not null,
  amount_usdc     numeric(12,2) not null check (amount_usdc > 0),
  active          boolean      not null default true,
  created_at      timestamptz  not null default now(),
  paused_at       timestamptz,
  constraint copy_trades_uniq unique (follower_id, trader_x_handle)
);
create index copy_trades_follower_idx on copy_trades (follower_id);
create index copy_trades_trader_idx   on copy_trades (trader_x_handle) where active = true;
```

**What it does:** stores the amount the user wants to auto-place per pick. The trading service places a live Gemini order whenever a new call is promoted for `trader_x_handle` and `active = true`.

### `tails.source` column

```sql
alter table tails add column source text not null default 'manual'
  check (source in ('manual', 'watch', 'copy'));
```

Distinguishes manually placed tails (extension tail card) from auto-created watch-paper-tails and copy-trade live tails. Used to filter the activity page.

---

## New API endpoints

### `apps/api` additions

#### `GET /v1/leaderboard?limit=50`

Returns top `limit` users sorted by score descending. Public, no auth.

```typescript
// Response
[
  { handle: "nfl_insider", score: 87, nResolved: 42, hitRate: 0.69, tier: "scored" },
  ...
]
```

Needs `leaderboard(limit: number): Promise<ScoreRow[]>` added to `ScoreStore`.

```sql
-- backing query
select u.x_handle, us.score, us.n_resolved, us.n_wins, us.hit_rate, us.score_change_14d, us.skill, us.last_call_at, us.updated_at
from user_scores us join users u on u.id = us.user_id
order by us.score desc
limit $1
```

---

### `apps/trading` additions

All routes below require `X-Follower-Id: <uuid>` header (same auth pattern as `POST /v1/tails`).

#### `POST /v1/watches`
Body: `{ traderHandle: string }`
Upserts a row in `watches`. Returns 201.

#### `DELETE /v1/watches/:traderHandle`
Deletes the watch row. Returns 204.

#### `GET /v1/watches`
Lists all watches for the follower, with aggregated paper PnL from `source='watch'` tails.

```typescript
// Response per item
{
  traderHandle: string,
  watchedAt: string,            // ISO
  nPicks: number,               // total calls tailed on their behalf
  paperPnlUsdc: number | null,  // null if no settled picks yet
  activePicks: number,          // open paper tails
}
```

#### `POST /v1/copy-trades`
Body: `{ traderHandle: string, amountUsdc: number }`
Upserts a row in `copy_trades` (creates or reactivates). Returns 201.

#### `PATCH /v1/copy-trades/:traderHandle`
Body: `{ amountUsdc?: number, active?: boolean }`
Updates the config. Returns 200.

#### `GET /v1/copy-trades`
Lists active copy-trade configs with recent tail count and live PnL.

#### `POST /v1/calls/notify` ← internal

Called by Pranav's pipeline (or by `apps/api` after promoting a call) when a new call is ready to trade. Protected by `X-Service-Key`.

Body: `{ callId: string }`

Flow:
1. Load call + market; verify market is `open` and before `lock_time`
2. Find all `watches` rows where `trader_x_handle = call.user.x_handle`
3. For each watcher: create `source='watch'` paper tail of $1 via existing `createTail()`
4. Find all `copy_trades` rows where `trader_x_handle = call.user.x_handle` AND `active = true`
5. For each copy-trader: place live Gemini order via `gemini.placeOrder()`, write `source='copy'` tail

**Note:** step 3 and 5 fire in parallel; individual failures are logged but don't fail the whole request.

---

## Extension changes

### 1. Popover on badge click (`apps/extension/src/Badge.tsx` + new `Popover.tsx`)

```
[ score chip: 72 ▲4 ]  ← existing
        ↓ click
┌────────────────────────────┐
│ @nfl_insider               │
│ Score 72  42 picks  69% HR │
│                            │
│ [  Watch  ]  [ Copy Trade ]│
│                            │
│ Open coPAYMe ↗             │
└────────────────────────────┘
```

- Clicking Watch calls `POST /v1/watches` on the trading service
- Clicking Copy Trade opens an inline amount input, then calls `POST /v1/copy-trades`
- "Open coPAYMe" links to `${WXT_WEB_URL}/traders/:handle`
- Popover closes on outside click
- Popover reads full profile from `GET /v1/users/:handle` on open (not pre-fetched)

### 2. Profile page overlay (`apps/extension/entrypoints/profile.tsx`)

Matches `https://x.com/[A-Za-z0-9_]{1,15}` (but not reserved paths like `/home`).

Finds the profile header element (uses `[data-testid="UserName"]` on the profile header — a different selector than tweets) and appends the same Watch + Copy Trade card below the bio.

Reuses the same `watchTrader` / `copyTradeTrader` calls.

### 3. Auth in the extension

The extension needs to know the logged-in user's `follower_id` to send with requests.

**Proposal:** Mugdha's X login flow stores `{ userId, jwt }` in `chrome.storage.local` after the OAuth callback. The extension reads it from storage. If not set, Watch/Copy Trade buttons show "Sign in with X" instead.

The extension already passes `X-Follower-Id`; it just needs to read it from storage rather than having it hardcoded.

### 4. `config.ts` additions

```typescript
export const TRADING_URL: string = import.meta.env.WXT_TRADING_URL ?? "http://localhost:8788";
export const WEB_URL: string = import.meta.env.WXT_WEB_URL ?? "http://localhost:3000";
```

### 5. `wxt.config.ts` additions

```typescript
host_permissions: [
  "https://x.com/*",
  `${apiOrigin}/*`,
  `${tradingOrigin}/*`,
]
```

---

## Website (`apps/web`) — Next.js

### Directory structure

```
apps/web/
  app/
    page.tsx              → redirect to /leaderboard
    leaderboard/
      page.tsx            → public SSR leaderboard
    traders/[handle]/
      page.tsx            → public SSR trader profile
    watchlist/
      page.tsx            → auth required, client
    activity/
      page.tsx            → auth required, client
    layout.tsx            → nav bar with coPAYMe logo + "My Watchlist" (if authed)
  lib/
    api.ts                → typed fetch wrappers
    auth.ts               → Mugdha's X login session helpers
  components/
    LeaderboardTable.tsx
    TraderCard.tsx
    WatchlistRow.tsx
    PnlChart.tsx          → recharts or similar
    TailRow.tsx
  package.json            → Next.js 15, react 19, @copayme/shared workspace dep
```

### Pages

#### `/leaderboard` (public, SSR)

Fetches `GET /v1/leaderboard?limit=100` from scoring API server-side.
Table: Rank / Handle / Score / 14d change / Picks / Hit rate / Watch button (opens website watch flow, not extension).

#### `/traders/:handle` (public, SSR)

Fetches `GET /v1/users/:handle`.
Shows score, hit rate, pick history (needs new endpoint — see below), and Watch/Copy Trade buttons.

#### `/watchlist` (auth required, client)

Fetches `GET /v1/watches` from trading service.
Cards per watched trader: handle, score badge, paper PnL since you started watching, number of open picks.

#### `/activity` (auth required, client)

Fetches `GET /v1/users/:userId/tails?source=copy` from trading service.
Timeline of copy-trade fills with PnL per trade and a cumulative PnL chart.

### Auth flow

Mugdha's X login sets a session in Supabase Auth. The website reads it via `@supabase/ssr` (server-side `createServerClient`). Protected pages redirect to Mugdha's login page if no session.

For the demo with Mugdha's work not fully integrated: provide a manual "Enter your user ID" fallback that stores a UUID in `localStorage` — the same `X-Follower-Id` pattern the extension uses.

---

## Data flow: Watch → auto paper tail

```
Pranav's Grok pipeline
  POST /v1/posts (apps/api)
       │
       ▼
  Aditya's worker promotes call, sets status='pending'
       │
       ▼
  POST /v1/calls/notify (apps/trading, service key)
  { callId: "uuid" }
       │
       ├─── for each watcher of this trader:
       │      createTail({ source: 'watch', mode: 'paper', amountUsdc: 1 })
       │
       └─── for each active copy-trader of this trader:
              placeOrder(gemini) → createTail({ source: 'copy', mode: 'live', amountUsdc: config.amountUsdc })
```

**Who calls `POST /v1/calls/notify`?** Two options:

1. Pranav's Grok pipeline calls it after calling `POST /v1/posts`
2. Aditya's scoring API calls it after promoting a call to `status='pending'`

**Recommendation:** option 2 — Aditya's worker already knows when a call is promoted, so the trading service stays decoupled from Pranav's pipeline.

---

## Additional endpoint needed: call history per trader

The website trader profile page needs a list of that trader's calls. Add to `apps/api`:

#### `GET /v1/users/:handle/calls?status=pending,scored&limit=20`

Returns recent calls for display on the profile page. Needs a new store method and query over `calls join markets`.

---

## Work breakdown by owner

### Yash (trading service + website)

| Task | Touches |
|---|---|
| Schema migration: `watches`, `copy_trades`, `tails.source` | `supabase/migrations/20261120000000_watches_copy_trades.sql` |
| Trading API: Watch CRUD | `apps/trading/src/app.ts`, `store.ts`, `store.postgres.ts` |
| Trading API: CopyTrade CRUD | same |
| Trading API: `POST /v1/calls/notify` | same |
| Shared types: `WatchResponse`, `CopyTradeConfig` | `packages/shared/src/trading.ts` |
| Website scaffold | `apps/web/` |
| Website leaderboard page | `apps/web/app/leaderboard/` |
| Website trader profile page | `apps/web/app/traders/[handle]/` |
| Website watchlist page | `apps/web/app/watchlist/` |
| Website activity + PnL chart | `apps/web/app/activity/` |

### Aditya (scoring API + extension)

| Task | Touches |
|---|---|
| `GET /v1/leaderboard` | `apps/api` |
| `GET /v1/users/:handle/calls` | `apps/api` |
| Extension: badge popover + Watch/CopyTrade buttons | `apps/extension/src/Badge.tsx`, new `Popover.tsx` |
| Extension: profile page overlay | `apps/extension/entrypoints/profile.tsx` |
| Extension: config additions (`TRADING_URL`, `WEB_URL`) | `apps/extension/src/config.ts` |
| Extension: `watchTrader()`, `copyTradeTrader()` | `apps/extension/src/api.ts` |
| Call notify hook in scoring worker | `apps/api` worker |

### Mugdha (auth)

| Task | Touches |
|---|---|
| X login OAuth callback stores session in `chrome.storage.local` | X login app |
| Extension reads `userId` from storage for `X-Follower-Id` | `apps/extension` |
| Supabase Auth session for website | `apps/web/lib/auth.ts` |

---

## Open decisions

| # | Question | Recommendation |
|---|---|---|
| 1 | Should `POST /v1/calls/notify` be called by Pranav's pipeline or Aditya's worker? | Aditya's worker (cleaner coupling) |
| 2 | Watch always $1 paper? Or configurable? | Fixed $1 for now per user's spec |
| 3 | PnL chart library for the website? | Recharts (already popular in Next.js apps, no extra config) |
| 4 | Deployment: does the website need a separate Vercel project? | Yes — `apps/web` → Vercel, services on Fly.io or Railway |
| 5 | Extension: what happens if `POST /v1/calls/notify` fails mid-loop? | Log individual errors, don't retry; next sync will catch missed markets |
| 6 | Copy trade: should we also create a watch paper trail for copy-traders so they can see the paper side of their live trades? | Yes — both a paper tail (for the website's paper PnL view) and a live tail per copy-trade |
