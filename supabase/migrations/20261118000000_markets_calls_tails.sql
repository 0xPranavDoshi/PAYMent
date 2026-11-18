-- Markets: synced from Gemini Predictions (sports only for launch)
create table markets (
  id                uuid        primary key default gen_random_uuid(),
  gemini_market_id  text        not null unique,
  sport             text        not null,
  event_name        text        not null,
  -- [{label, instrumentSymbol, currentOdds}]
  outcomes          jsonb       not null default '[]',
  lock_time         timestamptz not null,
  status            text        not null default 'open'
                    check (status in ('open','locked','resolved','void')),
  winning_outcome   text,
  resolved_at       timestamptz,
  synced_at         timestamptz not null default now()
);

create index markets_status_idx    on markets (status);
create index markets_lock_time_idx on markets (lock_time);

-- Posts: written by Pranav's Grok pipeline via POST /v1/posts
create table posts (
  id               uuid        primary key default gen_random_uuid(),
  tweet_id         text        not null unique,
  user_id          uuid        not null references users (id) on delete cascade,
  tweeted_at       timestamptz not null,
  tweet_text       text        not null,
  sentiment        jsonb,
  gemini_market_id text        references markets (gemini_market_id) on delete set null,
  picked_outcome   text,
  parsed_at        timestamptz not null default now()
);

create index posts_user_idx   on posts (user_id);
create index posts_market_idx on posts (gemini_market_id) where gemini_market_id is not null;

-- Calls: promoted from posts (one per user per market, before lock_time)
create table calls (
  id              uuid             primary key default gen_random_uuid(),
  post_id         uuid             not null unique references posts (id) on delete cascade,
  user_id         uuid             not null references users (id) on delete cascade,
  market_id       uuid             not null references markets (id) on delete cascade,
  picked_outcome  text             not null,
  tweeted_at      timestamptz      not null,
  odds_at_call    double precision not null check (odds_at_call between 0 and 1),
  odds_source     text             not null check (odds_source in ('history','snapshot')),
  ingest_lag_s    integer          not null default 0,
  status          text             not null default 'pending'
                  check (status in ('pending','scored','void','rejected')),
  points          double precision,
  -- first tweet per user per market wins; subsequent picks are ignored
  constraint calls_one_per_user_market unique (user_id, market_id)
);

create index calls_user_idx   on calls (user_id);
create index calls_market_idx on calls (market_id);
create index calls_status_idx on calls (status);

-- Tails: paper and live trades written by the trading service
create table tails (
  id              uuid         primary key default gen_random_uuid(),
  follower_id     uuid         not null references users (id) on delete cascade,
  call_id         uuid         not null references calls (id) on delete cascade,
  mode            text         not null check (mode in ('paper','live')),
  amount_usdc     numeric(12,2) not null check (amount_usdc > 0),
  entry_odds      double precision not null check (entry_odds between 0 and 1),
  gemini_order_id text,
  status          text         not null default 'open'
                  check (status in ('open','filled','settled','cancelled')),
  pnl_usdc        numeric(12,2),
  created_at      timestamptz  not null default now()
);

create index tails_follower_idx on tails (follower_id);
create index tails_call_idx     on tails (call_id);

alter table markets enable row level security;
alter table posts   enable row level security;
alter table calls   enable row level security;
alter table tails   enable row level security;
