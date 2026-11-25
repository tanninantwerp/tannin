-- Moving an existing booking to a new time, date, party size, or area, and
-- re-fitting a table for it — the thing staff had no way to do, short of
-- cancelling and re-booking (which lost the reservation number, re-ran
-- allocation blind, and fired a cancellation e-mail at the guest).
--
-- This re-runs the same allocation `book_table` does, but against a booking
-- that already exists. The one wrinkle a fresh booking does not have: the row
-- must not block itself. A move from 19:00 to 19:30 at the same table overlaps
-- its own turn, so the search would find the table "taken" — by the very
-- booking being moved. Clearing its seat first (so it occupies nothing) and
-- then allocating fresh sidesteps that without `table_has_room` needing to
-- learn about an "except this one" case.
--
-- Staff only, and only for a booking still ahead of service — a seated,
-- cancelled, or no-show booking is history, not something to re-fit. Contact
-- details (name, phone, e-mail, notes) are edited straight through row-level
-- security and never come here; this is only for the fields that change which
-- table fits.
--
-- Idempotent: a plain create-or-replace.

create or replace function reschedule_booking(
  p_id    uuid,
  p_date  date,
  p_time  time,
  p_party int,
  p_area  text default null
)
returns booking_status
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  chosen_id          uuid;
  chosen_override_id uuid;
  combo_a            uuid;
  combo_b            uuid;
  wanted_area        text := case when p_area in ('inside', 'terrace', 'bar') then p_area else null end;
  present            booking_status;
  new_status         booking_status;
begin
  if not is_staff() then
    raise exception 'staff only';
  end if;
  if p_party < 1 or p_party > 8 then
    raise exception 'party size out of range';
  end if;
  if p_date < current_date or p_date > current_date + 365 then
    raise exception 'date out of range';
  end if;

  select status into present from bookings where id = p_id;
  if present is null then
    raise exception 'no such booking';
  end if;
  if present not in ('pending', 'confirmed') then
    raise exception 'only an upcoming booking can be moved';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_date::text));

  -- Step the booking out of the way so the search below cannot see it as
  -- occupying the table it is being moved onto.
  update bookings
  set table_id = null, joined_table_id = null, seat_indices = null
  where id = p_id;

  -- Same single-table search as book_table: smallest table that fits, free for
  -- the new slot, in the wanted area if one was asked for.
  select t.id, t.override_id into chosen_id, chosen_override_id
  from effective_tables_for(p_date) t
  where t.seats >= p_party
    and t.min_seats <= p_party
    and (wanted_area is null or t.area = wanted_area)
    and not exists (
      select 1 from area_closures ac
      where ac.area = t.area and p_date between ac.from_date and ac.to_date
    )
    and table_has_room(t.id, t.override_id, t.seats, t.is_shared, p_date, p_time, p_party)
  order by t.seats asc, t.position asc
  limit 1;

  -- Nothing single fits: try a joined pair, same as book_table.
  if chosen_id is null and chosen_override_id is null then
    select c.table_a, c.table_b into combo_a, combo_b
    from combo_tables_for(p_date, p_time, p_party, wanted_area) c;
  end if;

  new_status := case
    when chosen_id is not null or chosen_override_id is not null or combo_a is not null
      then 'confirmed' else 'pending'
  end::booking_status;

  update bookings set
    date                  = p_date,
    time                  = p_time,
    party_size            = p_party,
    requested_area        = wanted_area,
    table_id              = coalesce(chosen_id, combo_a),
    joined_table_id       = combo_b,
    day_override_table_id = chosen_override_id,
    status                = new_status,
    -- A move is not a cancellation; never leave a stale marker behind.
    cancelled_by          = null
  where id = p_id;

  return new_status;
end;
$$;

revoke execute on function reschedule_booking(uuid, date, time, int, text) from public;
grant execute on function reschedule_booking(uuid, date, time, int, text) to authenticated;
