-- Earnings ledger: x402 / Nanopayment reward accruals and redemptions.
-- Owned by the on-chain workstream (Mugdha). One row per money movement for a user:
--   amount_usdc > 0  → reward credited to the creator (vault → creator on Arc)
--   amount_usdc < 0  → redeemed / withdrawn to the user's connected wallet
-- tx_hash is the Arc Testnet settlement (reward) or withdrawal (redeem) transaction;
-- null only while a payout is still in flight.

create table earnings_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  -- Signed. 6 dp so sub-cent micropayments are representable.
  amount_usdc numeric(18, 6) not null check (amount_usdc <> 0),
  -- 'tail_reward' | 'copy_reward' | 'redeem'. Free text so new reasons need no migration.
  reason      text not null,
  -- Arc tx hash for the settlement (reward) or withdrawal (redeem). Null while in flight.
  tx_hash     text,
  -- Idempotency key, e.g. 'reward:<tailId>', so a retried notify cannot double-pay.
  source_ref  text,
  created_at  timestamptz not null default now()
);

create index earnings_ledger_user_idx on earnings_ledger (user_id, created_at desc);
create unique index earnings_ledger_source_ref_idx
  on earnings_ledger (source_ref) where source_ref is not null;

-- Only the service role (the on-chain service) writes here. The extension and website
-- read through the API, so no anon/authenticated policies are created.
alter table earnings_ledger enable row level security;
