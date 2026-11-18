-- Fix 1: one post can have multiple picks (e.g. "Chiefs cover AND over 47.5")
alter table calls drop constraint calls_post_id_key;

-- Fix 2: trading service needs instrument_symbol and side to place orders
alter table calls add column instrument_symbol text;
alter table calls add column side             text check (side in ('yes', 'no'));

-- Fix 3: picks tweeted before the market opens have no live price
alter table calls alter column odds_at_call   drop not null;

-- Fix 4: picks with no price source are valid; expand allowed values
alter table calls drop constraint calls_odds_source_check;
alter table calls add  constraint calls_odds_source_check
  check (odds_source in ('history', 'snapshot', 'none'));
