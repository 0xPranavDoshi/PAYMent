-- watches: follower tracks a trader; $1 paper tail is auto-created per new call
create table watches (
  id              uuid        primary key default gen_random_uuid(),
  follower_id     uuid        not null references users(id) on delete cascade,
  trader_x_handle text        not null,
  created_at      timestamptz not null default now(),
  constraint watches_uniq unique (follower_id, trader_x_handle)
);
create index watches_follower_idx on watches (follower_id);
create index watches_trader_idx   on watches (trader_x_handle);

-- copy_trades: auto-place live Gemini order per new call, configurable amount
create table copy_trades (
  id              uuid          primary key default gen_random_uuid(),
  follower_id     uuid          not null references users(id) on delete cascade,
  trader_x_handle text          not null,
  amount_usdc     numeric(12,2) not null check (amount_usdc > 0),
  active          boolean       not null default true,
  created_at      timestamptz   not null default now(),
  paused_at       timestamptz,
  constraint copy_trades_uniq unique (follower_id, trader_x_handle)
);
create index copy_trades_follower_idx on copy_trades (follower_id);
create index copy_trades_trader_idx   on copy_trades (trader_x_handle) where active = true;

-- distinguish manual (from extension tail card), watch (auto $1 paper), copy (auto live)
alter table tails add column source text not null default 'manual'
  check (source in ('manual', 'watch', 'copy'));
