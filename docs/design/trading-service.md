# coPAYMe — Trading Service Design Doc

Yash Bapat · Nov 16, 2026 · Updated Nov 18, 2026

## Overview

This workstream ships the trading service: a Hono HTTP API (`apps/trading`) that lets a user tail any scored pick as either a paper trade (simulated) or a live trade (real order on Gemini Predictions sandbox). It also owns the market sync job that pulls sports events from Gemini into the shared Supabase DB so the Chrome extension can show live odds.

## Goals and non-goals

**Goals**

- **One-click tail.** The extension tail card sends a single `POST /v1/tails` and gets back a filled or pending status.
- **Slippage guard.** Reject orders if the live price moved more than 5 cents from the odds shown when the user clicked.
- **Market sync.** Keep the `markets` table current so every other service can read lock times and outcomes without hitting Gemini directly.
- **Paper mode.** Simulate trades against historical odds for users without a funded Gemini account.

**Non-goals**

- Portfolio management, position sizing, or stop-losses.
- Non-sports markets (scope matches Aditya's scoring workstream).
- Order book depth or partial fills beyond the IOC response.

## Architecture

```
Gemini Predictions API (production — read)
        │  listSportsEvents / getEvent
        ▼
  apps/trading  ──── POST /v1/markets/sync ──► Supabase markets table
        │
        │  POST /v1/tails
        ▼
Gemini Predictions API (sandbox — write)
        │  placeOrder (IOC)
        ▼
  Supabase tails table ◄──── GET /v1/tails/:id (Chrome extension)
```

The service is a Node.js Hono app on port 8788. It shares the Supabase Postgres instance with `apps/api` (scoring) and uses `packages/shared` for the Zod types that the Chrome extension also imports.

**Two Gemini base URLs** are intentional:
- `GEMINI_READ_BASE_URL` defaults to `https://api.gemini.com` — sports markets only exist on production
- `GEMINI_ORDER_BASE_URL` defaults to `https://api.sandbox.gemini.com` — orders go to sandbox so we don't spend real money during the demo

## API endpoints

### `POST /v1/tails`

Place a paper or live tail on a call.

Request headers:
- `X-Follower-Id: <uuid>` — follower's user ID (sent by extension; replaced by Mugdha's X login JWT once wired)

Request body (`TailRequest` from `@copayme/shared`):
```json
{
  "callId": "uuid",
  "mode": "paper" | "live",
  "amountUsdc": 10.00,
  "quotedOdds": 0.54
}
```

Response (`TailResponse`):
```json
{
  "tailId": "uuid",
  "status": "open" | "filled" | "settled" | "cancelled",
  "mode": "paper" | "live",
  "entryOdds": 0.54,
  "amountUsdc": 10.00,
  "geminiOrderId": "12345" | null,
  "pnlUsdc": null
}
```

Flow:
1. Validate `X-Follower-Id` UUID
2. Load `call` and its `market`; reject if market is not `open`
3. Find the contract in `market.outcomes` by label or `instrumentSymbol`
4. Compute side-specific price: `call.side === 'no'` → use `noOdds`, else `currentOdds`
5. Slippage check: `|entryOdds − quotedOdds| > 0.05` → 409
6. Paper mode: write to `tails`, return immediately
7. Live mode: `quantity = floor(amountUsdc / entryOdds)`, place IOC order, write tail

### `GET /v1/tails/:id`

Returns tail status. For paper trades, computes P&L on-the-fly when the market has resolved by comparing `call.side` against the contract's `resolutionSide` in `market.outcomes`.

### `GET /v1/users/:userId/tails`

Portfolio: all tails for a follower, newest first.

### `GET /v1/markets`

List open sports markets (used by extension to populate the tail card odds).

### `POST /v1/markets/sync`

Trigger a Gemini market sync. Requires `X-Service-Key` header (value from `TRADING_SERVICE_KEY`). Returns `{ upserted, errors }`. Returns 207 if any sport errored.

### `GET /health`

Always returns `{ ok: true }`.

## Data model

See `supabase/migrations/20261118000000_markets_calls_tails.sql` for the full schema. Key tables:

**`markets`** — synced from Gemini, one row per event ticker
- `gemini_market_id` = Gemini event ticker (e.g. `NFL-2611200100-KC-PHI-M`), unique
- `outcomes` JSONB — array of `OutcomeInfo`: `{ label, instrumentSymbol, currentOdds, noOdds, resolutionSide }`
- `lock_time` = game start (`effectiveDate` from Gemini), not settlement deadline
- `status`: `open` → `locked` → `resolved` | `void`

**`calls`** — written by Pranav's Grok pipeline
- `instrument_symbol` — which Gemini contract (also stored in `picked_outcome` by label)
- `side` — `yes` | `no` — which direction the influencer picked
- `odds_at_call` — nullable (some picks are tweeted before the market is priced)

**`tails`** — written by this service
- `entry_odds` — recorded at fill time, used for P&L
- `gemini_order_id` — null for paper trades; order ID for live trades
- `pnl_usdc` — set by the scoring worker when market resolves; computed on-the-fly for paper reads

## Gemini API

**Auth:** HMAC-SHA384. Payload is base64-encoded JSON `{ request, nonce, ...params }`. Headers: `X-GEMINI-APIKEY`, `X-GEMINI-PAYLOAD`, `X-GEMINI-SIGNATURE`. Only needed for `placeOrder` (private endpoint). Market read endpoints are public.

**Order type:** `limit` with `timeInForce: immediate-or-cancel`. An IOC order either fills immediately or is cancelled — no open resting orders to manage.

**Contracts vs events:** A Gemini event (game) has multiple contracts (YES/NO binary outcomes per line). The `instrumentSymbol` is the identifier used in orders. The `ticker` is the stable event identifier (use this, not numeric `id`).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Supabase Postgres connection string |
| `GEMINI_API_KEY` | — | Sandbox API key |
| `GEMINI_API_SECRET` | — | Sandbox API secret |
| `GEMINI_READ_BASE_URL` | `https://api.gemini.com` | Production endpoint for market reads |
| `GEMINI_ORDER_BASE_URL` | `https://api.sandbox.gemini.com` | Sandbox endpoint for order placement |
| `TRADING_SERVICE_KEY` | — | Static secret guarding `/v1/markets/sync` |
| `TRADING_PORT` | `8788` | HTTP listen port |

## Setup

```bash
# 1. Install dependencies (run from monorepo root)
pnpm install

# 2. Apply schema migrations
supabase db push   # or run SQL files manually against your Supabase project

# 3. Copy and fill env vars
cp .env.example .env
# Set DATABASE_URL, GEMINI_API_KEY, GEMINI_API_SECRET, TRADING_SERVICE_KEY

# 4. Start the trading service
pnpm --filter @copayme/trading dev
```

Seed markets for local testing:
```bash
curl -X POST http://localhost:8788/v1/markets/sync \
  -H "X-Service-Key: $TRADING_SERVICE_KEY"
```

## Integration contracts

### With Pranav's Grok pipeline

Pranav's pipeline calls `POST /v1/posts` on `apps/api` (Aditya's service), which writes to the `posts` table and promotes eligible picks into `calls`. The trading service reads from `calls`; it does **not** write them. The critical fields Pranav must populate: `market_id` (by looking up `markets.gemini_market_id` using the event ticker), `instrument_symbol`, and `side`.

### With Aditya's Chrome extension

The extension tail card imports `TailRequest` and `TailResponse` from `@copayme/shared`. It sends `POST /v1/tails` with the follower's UUID in `X-Follower-Id`. Odds displayed to the user come from `GET /v1/markets` → `outcomes[i].currentOdds` (YES side) or `outcomes[i].noOdds` (NO side), and the same value is passed back as `quotedOdds` for the slippage check.

### With Mugdha's X login

`X-Follower-Id` is a temporary placeholder. Once Mugdha's X login is wired, the extension will attach a signed JWT and the trading service will verify it instead of accepting a bare UUID.

## Known issues and fixes (post-merge, Nov 18 2026)

These were caught by teammates after the initial merge and fixed in PR #26 (`trading-fixes`).

| # | Issue | Root cause | Fix |
|---|---|---|---|
| 1 | Market id mismatch | `sync.ts` stored `event.id` (numeric); Pranav's scout matches by `event.ticker` (string) | Use `event.ticker` as `gemini_market_id` |
| 2 | Wrong lock time | `lockTimeFor()` used `expiryDate` (settlement, ~2 days after game); a pick tweeted after tip-off would pass the lock check | Use `effectiveDate` (game start) |
| 3 | Settled events never fetched | Unfiltered listing returns only active events; no market ever reached `resolved` | Fetch `status=active` and `status=settled` explicitly |
| 4 | One winner per market | `winningOutcomeFor()` returned the first YES contract; spread/total/prop markets have multiple | Store `resolutionSide` per contract in `OutcomeInfo`; P&L checks `call.side === contract.resolutionSide` |
| 5 | Orders always buy YES | `placeOrder` hardcoded `outcome: 'yes'` at the YES price; NO picks were priced and ordered wrong | Use `call.side` as `outcome`; price NO picks at `buy.no` |
| 6 | Sandbox has no sports markets | `api.sandbox.gemini.com` lists 106 non-sports events | Read markets from `api.gemini.com`; orders still go to sandbox |
