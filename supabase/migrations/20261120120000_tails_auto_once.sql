-- An automatic tail (watch or copy) is created at most once per follower and call.
-- POST /v1/calls/notify relies on this: running it twice for the same call must never give
-- a follower a second paper tail or, worse, a second live order. Manual tails (the tail card)
-- are not covered: a user may tail the same call twice on purpose.
--
-- This fails if duplicate automatic tails already exist. The shared database had none when this
-- was written (no tails at all), so nothing is deleted here.
create unique index tails_auto_once_idx
  on tails (follower_id, call_id, source)
  where source in ('watch', 'copy');
