-- Lets staff watch the guest book arrive, live.
--
-- Row-level security already decides who may read a booking (`staff read
-- bookings`, is_staff()) — Realtime enforces that same policy against the
-- subscriber's own JWT, so adding the table to the publication is the only
-- step needed here. Nobody unauthenticated, and no staff member without
-- access to `bookings`, sees anything more than they already could.

do $$ begin
  alter publication supabase_realtime add table bookings;
exception when duplicate_object then null;
end $$;
