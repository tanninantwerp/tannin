-- The rendering details behind the floor plan, made real columns.
--
-- 0017 gave every table a position; it did not give it a shape or a seating
-- direction. Those lived only in the floor-map editor built alongside it —
-- fine for a mockup, wrong for the admin's own plan, which needs to draw the
-- exact same room: a rotated six-top, a wall counter that seats people facing
-- the wall, three inside tables shorter on the wall side and seated across
-- from each other. Getting that right took several rounds of correction
-- against the real room; this migration is that same, already-checked layout,
-- not a fresh guess.
--
--   w, h        — footprint in the editor's own units (not millimetres).
--   vertical    — true once a table has been turned 90°: its long sides are
--                 now left/right rather than top/bottom, and split seating
--                 (below) follows.
--   one_row     — every chair on a single edge, backs to the wall — a bench
--                 or a counter, not a table people sit around.
--   flip_row    — for a one_row table, puts the chairs on the opposite edge
--                 (above instead of below, or left instead of right).
--   ends        — seats only at the two short ends, facing across the table
--                 rather than along it.
--   connect_group — tables that push together into one bookable run, e.g. the
--                 four street tables or the two pavement two-tops.

alter table dining_tables
  add column if not exists w             int,
  add column if not exists h             int,
  add column if not exists vertical      boolean not null default false,
  add column if not exists one_row       boolean not null default false,
  add column if not exists flip_row      boolean not null default false,
  add column if not exists ends          boolean not null default false,
  add column if not exists connect_group text;

update dining_tables set w = g.w, h = g.h, vertical = g.vertical, one_row = g.one_row,
  flip_row = g.flip_row, ends = g.ends, connect_group = g.connect_group
from (values
  -- ── terrace ──────────────────────────────────────────────────────────────
  ('Terrace — street 6',          170, 78,  false, false, false, false, 'street'),
  ('Terrace — street 2a',          62, 74,  false, false, false, false, 'street'),
  ('Terrace — street 2b',          62, 74,  false, false, false, false, 'street'),
  ('Terrace — street 2c',          62, 74,  false, false, false, false, 'street'),
  ('Terrace — front 6',            78, 170, true,  false, false, false, null),
  ('Terrace — pavement 2 (high)',  62, 74,  true,  false, false, false, null),
  ('Terrace — pavement 2 (low)',   74, 62,  false, false, false, true,  null),
  ('Terrace — pavement 2c',        74, 62,  false, false, false, true,  'pav'),
  ('Terrace — pavement 2d',        74, 62,  false, false, false, true,  'pav'),
  ('Terrace — centre 4',          120, 80,  false, false, false, false, null),
  ('Terrace — side 4',             76, 120, true,  false, false, false, null),
  ('Terrace — wall counter',       46, 200, false, true,  false, false, null),
  -- ── bar ──────────────────────────────────────────────────────────────────
  ('Counter Bar',                 210, 54,  false, true,  false, false, null),
  ('Counter Wall',                210, 54,  false, true,  true,  false, null),
  ('Window 3',                     74, 62,  false, true,  false, false, null),
  -- ── inside ───────────────────────────────────────────────────────────────
  ('Inside — wall 2a',             62, 74,  true,  false, false, false, null),
  ('Inside — wall 2b',             62, 74,  true,  false, false, false, null),
  ('Inside — wall 2c',             62, 74,  true,  false, false, false, null),
  ('Long table',                  640, 98,  false, false, false, true,  null),
  ('Inside — back 2a',             62, 74,  false, false, false, false, 'back'),
  ('Inside — back 2b',             62, 74,  false, false, false, false, 'back'),
  ('Inside — back 2c',             74, 56,  false, false, false, true,  'back'),
  ('Inside — back 2d',             74, 62,  false, false, false, true,  'back')
) as g(name, w, h, vertical, one_row, flip_row, ends, connect_group)
where dining_tables.name = g.name;
