-- The actual room, as far as anybody has written it down.
--
-- Replaces the ten invented tables 0006 seeded. Provisional until somebody
-- walks the floor with a tape measure, but it is the real shape of the place
-- rather than a guess that added up to a round number.
--
--   Terrace   3 × 6, 6 × 4, 5 × 2                     52
--   Inside    1 × 16 long, 3 × 4, 3 × 2 wall          34
--   Bar       high table across the bar, 4             4
--   Bar       stools                                   5
--                                                     ---
--                                                      95
--
-- Which is a long way from the 40 the old capacity constant assumed. That
-- constant only ever guarded a check the client could not run anyway; the real
-- limit is now per-table and lives in `book_table`.

-- Clear out 0006's placeholders, but only the ones nobody has been seated at.
-- A table with bookings against it is real data, whatever it is called.
delete from dining_tables t
where t.name in ('T1','T2','T3','T4','T5','T6','T7','T8','H1','H2')
  and not exists (select 1 from bookings b where b.table_id = t.id);

insert into dining_tables (name, seats, min_seats, area, active, position)
select * from (values
  -- ── terrace ──────────────────────────────────────────────────────────────
  -- Fourteen tables and more than half the covers. All of it is weather, which
  -- is why the admin can shut the whole area with one switch.
  ('Terras 6a', 6, 4, 'terrace', true, 10),
  ('Terras 6b', 6, 4, 'terrace', true, 11),
  ('Terras 6c', 6, 4, 'terrace', true, 12),
  ('Terras 4a', 4, 2, 'terrace', true, 13),
  ('Terras 4b', 4, 2, 'terrace', true, 14),
  ('Terras 4c', 4, 2, 'terrace', true, 15),
  ('Terras 4d', 4, 2, 'terrace', true, 16),
  ('Terras 4e', 4, 2, 'terrace', true, 17),
  ('Terras 4f', 4, 2, 'terrace', true, 18),
  ('Terras 2a', 2, 1, 'terrace', true, 19),
  ('Terras 2b', 2, 1, 'terrace', true, 20),
  ('Terras 2c', 2, 1, 'terrace', true, 21),
  ('Terras 2d', 2, 1, 'terrace', true, 22),
  ('Terras 2e', 2, 1, 'terrace', true, 23),

  -- ── inside ───────────────────────────────────────────────────────────────
  -- The long table seats sixteen and takes a minimum of ten, which puts it out
  -- of the website's reach entirely: online bookings stop at eight. That is
  -- deliberate. It is the communal table, for walk-ins and for events somebody
  -- arranges by talking to a person, and handing it to a couple booking at
  -- 19:30 would be the worst use of the best furniture in the room.
  ('Lange tafel', 16, 10, 'inside', true, 30),
  ('Binnen 4a',    4,  2, 'inside', true, 31),
  ('Binnen 4b',    4,  2, 'inside', true, 32),
  ('Binnen 4c',    4,  2, 'inside', true, 33),
  ('Wand 2a',      2,  1, 'inside', true, 34),
  ('Wand 2b',      2,  1, 'inside', true, 35),
  ('Wand 2c',      2,  1, 'inside', true, 36),

  -- ── the bar ──────────────────────────────────────────────────────────────
  -- The high table across from the bar is a table and books like one.
  ('Hoge tafel', 4, 2, 'inside', true, 40),

  -- The stools are not. The allocator gives a party exactly one table, so it
  -- cannot spread four people across four stools — and bar seats are walk-in
  -- anyway, which is most of the point of a wine bar. Inactive keeps them in
  -- the plan, and out of the website's hands.
  ('Bar', 5, 1, 'inside', false, 41)
) as seed(name, seats, min_seats, area, active, position)
-- Named rather than positional, so re-running this is safe and adding a table
-- by hand in the admin first does not get it duplicated here.
where not exists (select 1 from dining_tables d where d.name = seed.name);
