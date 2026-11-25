-- The floor plan, in English, pinned to real positions.
--
-- This supersedes every earlier seed of the room — the Dutch names from 0008
-- and the bar-stool split from 0010. The admin is English-only, and the plan
-- itself changed shape once somebody walked the floor: twenty-three tables, the
-- bar counter and its wall as bookable seats, a single high counter along the
-- terrace wall (three stools), and the long communal table down the middle of
-- the room.
--
-- Two rules the old schema carried only in prose now have columns:
--   is_high    — a bar-height table (a "high" chair), as opposed to a low one.
--   is_shared  — its open chairs are offered to other parties of two-plus once
--                it already holds a booking (the long table and the six-tops).
-- And x / y place the table on the plan so the admin can draw it rather than
-- read a list. They are the editor's coordinates, not millimetres of a room.

alter table dining_tables
  add column if not exists x        int,
  add column if not exists y        int,
  add column if not exists is_high  boolean not null default false,
  add column if not exists is_shared boolean not null default false;

-- Clear the old room. Every table seeded before this migration has a null x
-- (the column was only just added), and every table in the new plan below is
-- inserted with an x set — so "x is null" is exactly "belongs to the old plan".
-- An old table nobody was ever seated at is deleted; one with bookings against
-- it is real history, so it is kept but taken out of the plan (made inactive).
delete from dining_tables t
where t.x is null
  and not exists (select 1 from bookings b where b.table_id = t.id);

-- The room, in English. Idempotent by name: re-running this, or adding one of
-- these by hand in the admin first, will not create a duplicate.
insert into dining_tables (name, seats, min_seats, area, active, position, x, y, is_high, is_shared)
select * from (values
  -- ── terrace ──────────────────────────────────────────────────────────────
  ('Terrace — street 6',          6, 2, 'terrace', true,  10, 270, 100, true,  true),
  ('Terrace — street 2a',         2, 2, 'terrace', true,  20, 500, 100, true,  false),
  ('Terrace — street 2b',         2, 2, 'terrace', true,  30, 570, 100, true,  false),
  ('Terrace — street 2c',         2, 2, 'terrace', true,  40, 640, 100, true,  false),
  ('Terrace — front 6',           6, 2, 'terrace', true,  50, 550, 360, true,  true),
  ('Terrace — pavement 2 (high)', 2, 2, 'terrace', true,  60,  40, 460, true,  false),
  ('Terrace — pavement 2 (low)',  2, 2, 'terrace', true,  70, 810, 510, false, false),
  ('Terrace — pavement 2c',       2, 2, 'terrace', true,  80, 260, 530, false, false),
  ('Terrace — pavement 2d',       2, 2, 'terrace', true,  90, 410, 530, false, false),
  ('Terrace — centre 4',          4, 2, 'terrace', true, 100, 290, 330, false, false),
  ('Terrace — side 4',            4, 2, 'terrace', true, 110, 810, 270, false, false),
  ('Terrace — wall counter',      3, 1, 'terrace', true, 120,  40, 200, true,  false),
  -- ── bar ──────────────────────────────────────────────────────────────────
  ('Counter Bar',                 4, 1, 'bar',     true, 130, 260, 770, true,  false),
  ('Counter Wall',                4, 2, 'bar',     true, 140, 260, 970, true,  true),
  ('Window 3',                    2, 2, 'bar',     true, 150, 700, 930, false, false),
  -- ── inside ────────────────────────────────────────────────────────────────
  ('Inside — wall 2a',            2, 2, 'inside',  true, 160, 400, 1100, true,  false),
  ('Inside — wall 2b',            2, 2, 'inside',  true, 170, 570, 1100, true,  false),
  ('Inside — wall 2c',            2, 2, 'inside',  true, 180, 720, 1100, true,  false),
  ('Long table',                 14, 2, 'inside',  true, 190, 250, 1340, true, true),
  ('Inside — back 2a',            2, 2, 'inside',  true, 200, 170, 1130, false, false),
  ('Inside — back 2b',            2, 2, 'inside',  true, 210, 250, 1130, false, false),
  ('Inside — back 2c',            2, 2, 'inside',  true, 220,  70, 1200, false, false),
  ('Inside — back 2d',            2, 2, 'inside',  true, 230,  70, 1270, false, false)
) as seed(name, seats, min_seats, area, active, position, x, y, is_high, is_shared)
where not exists (select 1 from dining_tables d where d.name = seed.name);

-- Anything still carrying a null x is a booked survivor of the old plan: keep
-- the row for its history, but take it out of the website's hands.
update dining_tables set active = false where x is null;
