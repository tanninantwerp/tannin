-- The bar stools count.
--
-- 0008 parked them: one row called 'Bar', five seats, inactive. The reasoning
-- was that the allocator hands a party exactly one table and so cannot spread
-- four people across four stools, and that bar seats are walk-in anyway. Sacha
-- has asked for the five back, and they are five real seats in a room of 95, so
-- leaving them out was leaving a twentieth of the place off the books.
--
-- They come back as five separate stools rather than as the one five-seat row
-- they were. That row would have been the wrong shape: `book_table` gives a
-- party one table and holds all of it, so a single person booking 'Bar' at
-- 19:30 would have taken all five seats off the market until half nine. Five
-- one-seat rows cannot do that. Each is booked by itself or by nobody.
--
-- What that means in practice: a party of one can now book a stool, and gets
-- one in preference to a two-top, because the allocator takes the smallest
-- table that fits — so this quietly frees tables as well as adding seats. A
-- pair who want to sit at the bar still walk in, exactly as they do today. If
-- that ever needs to change it is a question about how `book_table` allocates,
-- not about the furniture, and it should be answered there.

-- The five-seat placeholder, gone — but only if nobody was ever seated at it.
-- It was inactive from the day it was written, so this should always be true;
-- checking anyway, because a row with bookings against it is real data whatever
-- it is called.
delete from dining_tables t
where t.name = 'Bar'
  and not exists (select 1 from bookings b where b.table_id = t.id);

insert into dining_tables (name, seats, min_seats, area, active, position)
select * from (values
  ('Barkruk 1', 1, 1, 'inside', true, 50),
  ('Barkruk 2', 1, 1, 'inside', true, 51),
  ('Barkruk 3', 1, 1, 'inside', true, 52),
  ('Barkruk 4', 1, 1, 'inside', true, 53),
  ('Barkruk 5', 1, 1, 'inside', true, 54)
) as seed(name, seats, min_seats, area, active, position)
-- Named rather than positional, so re-running this is safe and a stool somebody
-- has already edited in the admin does not come back as a duplicate.
where not exists (select 1 from dining_tables d where d.name = seed.name);
