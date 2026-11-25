-- Which specific chairs a booking sits in, not just which table.
--
-- `table_id` alone cannot say "these two seats at Counter Bar, not those
-- two" — the whole-table lock is why a solo guest at the wall counter (or
-- any table) reads as the entire table taken. This does not change that
-- allocation on its own; it only gives staff assigning a party by hand
-- somewhere to record exactly which seats they picked on the floor plan.
-- Null means "the whole table", matching every booking made before this
-- column existed and every one the public site still auto-allocates —
-- `book_table` itself is unchanged.

alter table bookings add column if not exists seat_indices int[];
