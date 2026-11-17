-- Tables owned by the scoring workstream: users, score_snapshots, user_scores.
-- posts, calls, markets, tails and earnings_ledger wait on teammates' designs (issue #7).

create extension if not exists pgcrypto;

create table users (
  id               uuid primary key default gen_random_uuid(),
  x_user_id        text not null unique,
  x_handle         text not null,
  wallet_address   text,
  rewards_opt_in   boolean not null default false,
  created_at       timestamptz not null default now()
);

-- Handle lookups are case-insensitive and must be unique.
create unique index users_x_handle_lower_idx on users (lower(x_handle));

create table score_snapshots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  score        smallint not null check (score between 0 and 100),
  -- ids of the calls behind this score; no FK until the calls table exists
  call_ids     uuid[] not null default '{}',
  -- sha256 of sorted call_id:points pairs, so anyone can verify a snapshot
  inputs_hash  text not null check (inputs_hash ~ '^[0-9a-f]{64}$'),
  computed_at  timestamptz not null default now(),
  onchain_tx   text
);

-- "Latest snapshot at least 14 days old" and "latest snapshot" lookups.
create index score_snapshots_user_time_idx on score_snapshots (user_id, computed_at desc);

create table user_scores (
  user_id           uuid primary key references users (id) on delete cascade,
  score             smallint not null check (score between 0 and 100),
  score_change_14d  smallint,
  skill             double precision not null,
  n_resolved        integer not null default 0 check (n_resolved >= 0),
  n_wins            integer not null default 0 check (n_wins >= 0 and n_wins <= n_resolved),
  hit_rate          double precision check (hit_rate between 0 and 1),
  last_call_at      timestamptz,
  snapshot_id       uuid references score_snapshots (id) on delete set null,
  updated_at        timestamptz not null default now()
);

-- Only the service role (API and worker) touches these tables. The extension
-- goes through the API, so no anon or authenticated policies are created.
alter table users enable row level security;
alter table score_snapshots enable row level security;
alter table user_scores enable row level security;
