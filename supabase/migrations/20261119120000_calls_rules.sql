-- Rules on calls that the database enforces itself, so no service can skip them.
-- Builds on 20261119000000_calls_schema_fixes.sql (side, instrument_symbol, nullable odds).

-- 1. A pick must be tweeted before its market locks (design doc: anti-gaming).
--    Checked on insert and whenever the tweet time or market changes.
create function calls_check_lock_time() returns trigger
language plpgsql as $$
declare
  v_lock timestamptz;
begin
  select lock_time into v_lock from markets where id = new.market_id;
  if new.tweeted_at >= v_lock then
    raise exception 'pick tweeted at % is not before the market lock time %', new.tweeted_at, v_lock
      using errcode = 'check_violation', constraint = 'calls_tweeted_before_lock';
  end if;
  return new;
end;
$$;

create trigger calls_tweeted_before_lock
  before insert or update of tweeted_at, market_id on calls
  for each row execute function calls_check_lock_time();

-- 2. A call has a price exactly when its price source is not 'none'.
alter table calls add constraint calls_odds_present_iff_priced
  check ((odds_at_call is null) = (odds_source = 'none'));

-- 3. The side and its contract come together; the trading service needs both to place an order.
alter table calls add constraint calls_side_with_instrument
  check ((side is null) = (instrument_symbol is null));

-- 4. Indexes. Dropping the unique on post_id also dropped the index the foreign key used.
create index calls_post_idx on calls (post_id);
-- The worker's query: pending calls whose market has resolved.
create index calls_pending_market_idx on calls (market_id) where status = 'pending';
