-- Two small RLS cleanups, no behaviour change for staff.
--
-- 1. `dining_tables` has carried a public `select using (active)` policy
--    since 0006, back when the admin read it with the anon key. Every
--    caller now reads it signed in (`apps/web` never queries it at all —
--    guest availability goes through `free_slots`/`book_table`, both
--    `security definer`), so the anon key can currently list the whole
--    floor plan — names, seat counts, x/y layout — for no reason. Replaced
--    with a staff-only read, same as `area_closures`/`table_day_overrides`
--    already are; any signed-in staff member can still see the floor plan,
--    same as today, just not a stranger with the public key.
--
-- 2. `area_closures` and `table_day_overrides` each carry a `select` policy
--    that is byte-for-byte the same condition as their own `for all` policy
--    — `for all` already grants select, so the extra one is pure dead
--    weight, not a different rule. Dropped.

drop policy if exists "tables are public" on dining_tables;
drop policy if exists "staff read tables" on dining_tables;
create policy "staff read tables" on dining_tables for select using (is_staff());

drop policy if exists "tables read area closures" on area_closures;
drop policy if exists "tables read day overrides" on table_day_overrides;
