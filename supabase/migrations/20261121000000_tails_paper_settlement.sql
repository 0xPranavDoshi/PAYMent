-- Paper-sim settlement audit trail. Both nullable; populated when a paper tail settles.
alter table tails add column exit_odds  double precision check (exit_odds between 0 and 1);
alter table tails add column settled_at timestamptz;
