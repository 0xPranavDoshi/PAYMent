-- Owned by the Grok pipeline (docs/design/grok-pipeline.md).

-- Per-handle scan state: freshness check and lock
create table scout_handles (
  x_handle         text        primary key,
  x_user_id        text,
  status           text        not null default 'idle'
                   check (status in ('idle','running','failed')),
  newest_tweet_id  text,
  scanned_at       timestamptz,
  locked_at        timestamptz,
  last_error       text,
  created_at       timestamptz not null default now()
);

-- The cache: every fetched post and every AI output
create table scout_posts (
  tweet_id          text        primary key,
  x_handle          text        not null,
  x_user_id         text        not null,
  tweeted_at        timestamptz not null,
  tweet_text        text        not null,
  is_reply          boolean     not null default false,
  quoted_text       text,
  sentiment         jsonb,
  -- null = matching not done yet, retry
  matches           jsonb,
  pipeline_version  integer     not null,
  forwarded_at      timestamptz,
  created_at        timestamptz not null default now()
);

create index scout_posts_handle_idx on scout_posts (x_handle, tweeted_at desc);

alter table scout_handles enable row level security;
alter table scout_posts   enable row level security;
