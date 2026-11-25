-- Lets the "new events" badge catch a guest cancellation live, not just on
-- the next page load.
--
-- Same reasoning as 0019 for `bookings`: row-level security already decides
-- who may read `booking_changes` (`staff read booking changes`), Realtime
-- enforces that same policy against the subscriber's own JWT, so adding the
-- table to the publication is the only step needed here.

do $$ begin
  alter publication supabase_realtime add table booking_changes;
exception when duplicate_object then null;
end $$;
