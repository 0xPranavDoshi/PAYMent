# coPAYMe Trading Service — Design Doc

Nov 18, 2026 · Yash Bapat

## Overview

`apps/trading` is a standalone Hono service (port 8788) that handles order execution for coPAYMe. When a user clicks "tail" on the extension, this service either records a simulated paper trade or places a real limit order on the Gemini Predictions sandbox.

**This service owns:**
- Placing and tracking paper and live trades against Gemini sandbox
- The `tails` DB table
- Syncing sports market data from Gemini into the `markets` table
- Slippage protection (rejects if price moved >5 cents since the user saw the odds)

**This service does not own:**
- Parsing tweets or matching them to markets (Pranav — Grok bot)
- Scoring calls or running the settlement worker (Aditya — `apps/api`)
- X login, wallet connection, or on-chain reputation (Mugdha)

## Architecture

```
Extension        Trading Service         Gemini sandbox
(tail card)  ──► (apps/trading :8788) ──► (sandbox.gemini.com)
                        │  ▲
                        │  └── market data (sync)
                        ▼
                   Supabase DB
              (markets · calls · tails)
```

The extension's tail card sends `POST /v1/tails` and gets back a tail ID. For live trades the service calls the Gemini sandbox to place a limit order; for paper trades it only writes to the DB. Market sync (`POST /v1/markets/sync`) pulls sports events from Gemini on demand so the DB always has fresh instrument symbols and odds.

## API endpoints

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/v1/tails` | `X-Follower-Id` header | Place a paper or live trade. Slippage-checked (±5 cents). Live trades place an IOC limit order on Gemini sandbox. |
| `GET` | `/v1/tails/:id` | — | Get a tail's status and P&L. Paper-trade P&L computed on-the-fly once market resolves. |
| `GET` | `/v1/users/:userId/tails` | — | List all tails for a user (portfolio view for the extension). |
| `GET` | `/v1/markets` | — | Open sports markets — used by the tail card to show what's tradeable. |
| `POST` | `/v1/markets/sync` | `X-Service-Key` header | Pull sports events from Gemini and upsert into `markets`. Run before demo or on a cron. |
| `GET` | `/health` | — | Returns `{"ok":true}`. |

### POST /v1/tails — request shape

```ts
// Body
{
  callId: string;      // UUID of the calls row being tailed
  mode: 'paper' | 'live';
  amountUsdc: number;  // how much to risk
  quotedOdds: number;  // current odds shown to user (0–1); rejects if live price moved >0.05
}
// Header
X-Follower-Id: <user UUID>   // the logged-in follower's users.id
```

### POST /v1/tails — response shape (201)

```ts
{
  tailId: string;
  status: 'open' | 'filled' | 'settled' | 'cancelled';
  mode: 'paper' | 'live';
  entryOdds: number;
  amountUsdc: number;
  geminiOrderId: string | null;  // set for live trades
  pnlUsdc: number | null;        // set once market resolves
}
```

## Setup

Three things must be done before the service can run.

### 1. Gemini sandbox API keys

1. Go to [exchange.sandbox.gemini.com](https://exchange.sandbox.gemini.com) and create an account (separate from prod).
2. Under **API** → **Create a New API Key**, enable the **Order** permission scope.
3. Add to `.env`:

```
GEMINI_API_KEY=account_xxxxxxxxxxxxxxxxxxxxxxxxxx
GEMINI_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GEMINI_BASE_URL=     # leave blank — defaults to https://api.sandbox.gemini.com
```

### 2. Service key

Generate a shared secret for `POST /v1/markets/sync`:

```bash
openssl rand -hex 32
```

Add to `.env`:

```
TRADING_SERVICE_KEY=<output from above>
```

Share the same value with any teammate or cron job that needs to trigger a market sync.

### 3. Run the migration

The trading service needs five tables: `markets`, `posts`, `calls`, `tails`, `earnings_ledger`. These are in `supabase/migrations/20261118000000_markets_calls_tails.sql`.

**Against Supabase (shared team DB):**
Paste the migration SQL into Supabase Studio → **SQL Editor** and run it, or:

```bash
supabase db push
```

**Against a local Postgres (dev only):**

```bash
psql $DATABASE_URL -f supabase/migrations/20261118000000_markets_calls_tails.sql
```

Run migration 0001 first if starting fresh. After both, the full schema is:
`users`, `score_snapshots`, `user_scores` (migration 0001) + `markets`, `posts`, `calls`, `tails`, `earnings_ledger` (migration 0002).

## Integration contracts

| Teammate | They provide | Trading service provides |
| --- | --- | --- |
| **Aditya** (extension, tail card UI) | Sends `TailRequest` body + `X-Follower-Id` header to `POST /v1/tails`. The `callId` comes from the call the user clicked. | `tailId`, `entryOdds`, `status`, `geminiOrderId` in response. P&L readable via `GET /v1/tails/:id` once market resolves. |
| **Mugdha** (X login, wallet) | Once X login JWT is ready: replace the `X-Follower-Id` header with a bearer token. The trading service only needs to extract a `users.id` UUID from it. | No change to response shape. |
| **Pranav** (Grok bot) | Needs `markets` table populated before his matcher runs. | Call `POST /v1/markets/sync` (with `TRADING_SERVICE_KEY`) once at startup and before Pranav's pipeline processes posts. |

### X-Follower-Id header (temporary)

Auth is not yet wired. The extension sends the logged-in user's `users.id` as the `X-Follower-Id` header. This is a placeholder until Mugdha's X login flow issues a JWT. When the JWT is ready, swap the header to `Authorization: Bearer <token>` and add a one-line JWT decode in `app.ts`.

## Local dev

### Prerequisites

- Node 20+, pnpm 9.15 (`npm i -g pnpm@9.15.0`)
- A running Postgres (local or Supabase connection string)
- Both migrations applied (see [Setup](#setup))
- `.env` filled from `.env.example`

### Start the trading service

```bash
pnpm dev:trading
```

Confirm it's up:

```bash
curl http://localhost:8788/health
# {"ok":true}
```

### Seed markets for local testing

```bash
curl -X POST http://localhost:8788/v1/markets/sync \
  -H "X-Service-Key: $TRADING_SERVICE_KEY"
# {"upserted": 42, "errors": []}
```

### Place a test paper trade

```bash
curl -X POST http://localhost:8788/v1/tails \
  -H "Content-Type: application/json" \
  -H "X-Follower-Id: <any users.id UUID from your DB>" \
  -d '{"callId":"<uuid>","mode":"paper","amountUsdc":10,"quotedOdds":0.65}'
```

### Typecheck

```bash
pnpm --filter @copayme/trading typecheck
```

### Running alongside the scoring API

```bash
# terminal 1
pnpm dev:api       # scoring API on :8787

# terminal 2
pnpm dev:trading   # trading service on :8788
```
