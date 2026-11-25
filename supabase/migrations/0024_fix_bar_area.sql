-- The bar's three tables must carry area = 'bar', or they don't exist as far
-- as booking the bar is concerned.
--
-- `free_slots` and `book_table` answer "can the bar seat this party?" by
-- filtering `dining_tables` on `area = 'bar'` — a real column value, not the
-- table's name or where it sits on the map. A table drawn in the bar zone but
-- still carrying area = 'inside' is invisible to that query, so the bar reads
-- as full even when every stool is free.
--
-- This slipped through because 0017's English seed inserts these rows only
-- `where not exists (name)`: any Counter Bar / Counter Wall / Window 3 created
-- by hand (or by an earlier draft) before that migration kept its old area,
-- and the seed never corrected it. This is that correction — idempotent, and a
-- no-op once the value is already right.

update dining_tables
set area = 'bar'
where name in ('Counter Bar', 'Counter Wall', 'Window 3')
  and area is distinct from 'bar';
