# @copayme/onchain

The on-chain layer: **X login + wallet connect + opt-in**, **x402 micropayment rewards**
(vault → creator on Arc Testnet), an **earnings ledger**, and **redeem**. Node + Hono +
Postgres, same shape as `apps/api` and `apps/trading`.

## What it does

- A treasury vault (Circle wallet on Arc Testnet) pays creators a micro-reward when a
  follower tails/copies their pick. Rewards accrue to the `earnings_ledger`; creators
  redeem to their connected wallet.
- Payments go through a pluggable `PaymentProvider` so the whole service runs and tests
  with **no credentials** (mock), and switches to real Arc payments via one env flag.

## Run

```bash
pnpm install
pnpm --filter @copayme/onchain test        # 13 tests, no creds needed
pnpm --filter @copayme/onchain dev          # http://localhost:8790
```

Env (see repo `.env.example`): `ONCHAIN_SERVICE_KEY` (required), `STORE` (`memory` |
`postgres`; defaults to postgres when `DATABASE_URL` is set), `PAYMENT_PROVIDER`
(`mock` | `wallet` | `x402`), and the Circle vars below for the real paths.

## Payment providers (`PAYMENT_PROVIDER`)

| value | what | needs |
|---|---|---|
| `mock` (default) | deterministic fake tx hashes | nothing |
| `wallet` | real Arc USDC transfer per reward via a Circle Dev-Controlled wallet | `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `TREASURY_WALLET_ID` |
| `x402` | gasless, batched Circle Gateway **Nanopayment** (the micropayments headline) | `TREASURY_PRIVATE_KEY` + a one-time Gateway deposit + `@circle-fin/x402-batching` |

Missing creds for the chosen provider → it logs a warning and falls back to `mock`,
so the service always boots.

## One-time Circle setup

```bash
# 1. Put CIRCLE_API_KEY in .env (console.circle.com, Sandbox)
# 2. Provision the treasury (registers entity secret, creates the Arc wallet, writes .env):
pnpm --filter @copayme/onchain setup:treasury
# 3. Fund the printed treasury address at https://faucet.circle.com (Arc Testnet) — USDC.
```

For the **x402** path, also deposit vault USDC into the Gateway Wallet once (needs
`@circle-fin/x402-batching` + a local `TREASURY_PRIVATE_KEY`):

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";
const g = new GatewayClient({ chain: "arcTestnet", privateKey: process.env.TREASURY_PRIVATE_KEY });
await g.deposit("50");
```

## API

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | liveness + active payment provider |
| POST | `/v1/auth/x/upsert` | — | upsert `users` row after X login → `{ userId, handle, ... }` |
| POST | `/v1/wallet/link` | `x-user-id` | write `users.wallet_address` |
| PATCH | `/v1/rewards/opt-in` | `x-user-id` | write `users.rewards_opt_in` |
| POST | `/v1/rewards/accrue` | `x-service-key` | reward a creator for a tail (idempotent per `tailId`) |
| GET | `/v1/users/:id/earnings` | `x-user-id` (self) or `x-service-key` | ledger rows + totals |
| POST | `/v1/redeem` | `x-user-id` | redeem available USDC to the linked wallet |

`x-user-id` is the users-table UUID (same pattern as the trading service's
`x-follower-id`); the website's X login writes it into `chrome.storage` for the
extension. A JWT check replaces the header later.

## Integration contract

- **Trading (`apps/trading`):** after creating a tail, `POST /v1/rewards/accrue`
  with `{ creatorHandle, tailId, mode, amountUsdc }` and header
  `x-service-key: $ONCHAIN_SERVICE_KEY`. Idempotent per `tailId`; a payout failure
  returns `credited:false` and never blocks the caller.
- **Extension / web:** read `GET /v1/users/:id/earnings` to show a creator's earnings;
  call `POST /v1/redeem` from the redeem button.
- **DB:** this service owns `earnings_ledger` and writes only
  `users.wallet_address` / `users.rewards_opt_in`.

Reward size: `rewardAmount()` = 2% of the tail stake, min $0.01 (`src/config.ts`).
