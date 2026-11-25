-- Two areas: inside and terrace.
--
-- The plan grew four — 'inside', 'high', 'terrace', 'bar' — because each batch
-- of furniture arrived with its own name. But an area is not a description of
-- the furniture, it is the thing the admin opens and closes with one button,
-- and there is exactly one of those: the terrace, because it is outdoors in
-- Belgium. The high table and the five bar stools are indoors and are never
-- shut on their own, so as areas they were three buttons implying decisions
-- nobody makes.
--
-- Nothing about the booking logic changes: `book_table` has never looked at
-- `area`, only at seats, min_seats and active. Every table stays exactly as
-- bookable as it was. This is regrouping, not a change to the floor.

-- The high table and the stools are inside, because they are.
update dining_tables
set area = 'inside'
where area not in ('inside', 'terrace');

/*
 * Enforced in the database rather than only in the admin's dropdown. The
 * dropdown is a suggestion — anything holding the anon key could write
 * area='patio' and quietly create a fifth area that no button controls and
 * nobody would find until the terrace switch missed a table.
 */
alter table dining_tables drop constraint if exists dining_tables_area_check;
alter table dining_tables
  add constraint dining_tables_area_check check (area in ('inside', 'terrace'));

-- Was already 'inside'; restated so the column's default cannot drift out of
-- the constraint above and start rejecting plain inserts.
alter table dining_tables alter column area set default 'inside';
