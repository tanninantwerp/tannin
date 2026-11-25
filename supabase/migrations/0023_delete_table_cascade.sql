-- Deleting a table, not just deactivating it.
--
-- "Remove" (active = false) already existed and stays reversible — bookings
-- keep pointing at the row, and reactivating puts it back with the same
-- position and floor-plan coordinates untouched, since nothing about that
-- toggle ever wrote to them. This is for the other, permanent action: taking
-- the row out of dining_tables entirely.
--
-- Two foreign keys pointed at it with no ON DELETE behaviour specified,
-- which defaults to NO ACTION — a table with a same-day override on it, or a
-- booking still pointing at it, would refuse to delete with a raw constraint
-- error instead of the confirmation dialog actually doing what it said.
--
--   table_day_overrides.table_id  → cascade. An override for a table that no
--                                   longer exists isn't a real override.
--   bookings.day_override_table_id → set null, the same as bookings.table_id
--                                   already behaves for a deleted real table:
--                                   the booking survives, it just loses that
--                                   specific seat assignment.

alter table table_day_overrides
  drop constraint if exists table_day_overrides_table_id_fkey,
  add constraint table_day_overrides_table_id_fkey
    foreign key (table_id) references dining_tables (id) on delete cascade;

alter table bookings
  drop constraint if exists bookings_day_override_table_id_fkey,
  add constraint bookings_day_override_table_id_fkey
    foreign key (day_override_table_id) references table_day_overrides (id) on delete set null;
