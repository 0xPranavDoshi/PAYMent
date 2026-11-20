-- Daily revenue share (on-chain workstream).
-- Once a day an admin runs a payout: every follower trade (tail) that settled in profit and has
-- not been processed yet is charged a fee (0.7% of its profit). The fee is credited to the creator
-- whose pick it was IF that creator opted in before the trade's settle day (UTC); otherwise the
-- treasury retains it. Each trade is processed exactly once (payout_items.tail_id is the key).

-- When a creator turned rewards on. Rewards apply to trades settled from the next UTC day on.
alter table users add column rewards_opted_in_at timestamptz;
-- Existing opt-ins: treat them as opted in since the account was created.
update users set rewards_opted_in_at = created_at where rewards_opt_in and rewards_opted_in_at is null;

create table payout_runs (
  id              uuid primary key default gen_random_uuid(),
  -- UTC day the run happened; at most one run per day.
  run_day         date not null unique,
  run_by          text not null,
  fee_rate        numeric(8, 6) not null,
  tails           integer not null,
  follower_profit numeric(18, 6) not null,
  fee_total       numeric(18, 6) not null,
  -- Credited to opted-in creators' earnings ledgers.
  fee_credited    numeric(18, 6) not null,
  -- Kept by the treasury (creator not opted in, or opted in too recently).
  fee_retained    numeric(18, 6) not null,
  created_at      timestamptz not null default now()
);

create table payout_items (
  -- A trade is charged at most once, ever.
  tail_id     uuid primary key references tails (id) on delete cascade,
  run_id      uuid not null references payout_runs (id) on delete cascade,
  creator_id  uuid not null references users (id) on delete cascade,
  pnl_usdc    numeric(12, 2) not null,
  fee_usdc    numeric(18, 6) not null,
  credited    boolean not null
);
create index payout_items_run_idx on payout_items (run_id);
create index payout_items_creator_idx on payout_items (creator_id);

-- Only the service role (the on-chain service) touches these.
alter table payout_runs enable row level security;
alter table payout_items enable row level security;
