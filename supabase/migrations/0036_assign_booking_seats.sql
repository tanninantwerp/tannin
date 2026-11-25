-- Server-validated table/seat assignment for staff.
--
-- `book_table` and `reschedule_booking` are the only two paths that ever
-- re-check `table_has_room` before writing `table_id`/`joined_table_ids` —
-- everything else (confirming a `pending` request by hand, reseating from
-- the Day plan or the seat picker) has always gone straight through a plain
-- `update bookings set table_id = ...` from the client. That update carries
-- no lock, no closed/adhoc check and no overlap check, so two staff members
-- confirming two different pending requests onto the same table at the same
-- moment can both succeed, and a table taken out of the pool for the night
-- via `table_day_overrides` can still be handed out by hand. This closes
-- that gap the same way `reschedule_booking` already closes it for a
-- time/party change: step the booking out of its own way, then ask the same
-- `table_has_room` question the allocator asks.
--
-- Only real `dining_tables` rows are supported (as the seat picker already
-- only offers those) — an ad-hoc table can only ever be reached through
-- `allocate`, same as today.

create or replace function assign_booking_seats(
  p_id               uuid,
  p_table_id         uuid,
  p_seat_indices     int[] default null,
  p_joined_table_ids uuid[] default '{}'
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b          record;
  t_seats    int;
  t_shared   boolean;
  jt_id      uuid;
  jt_seats   int;
  jt_shared  boolean;
begin
  if not has_perm('bookings') then
    raise exception 'staff only';
  end if;

  select id, date, time, party_size into b from bookings where id = p_id;
  if b.id is null then
    raise exception 'no such booking';
  end if;

  perform pg_advisory_xact_lock(hashtext(b.date::text));

  -- Step this booking out of the way so it cannot read itself as the
  -- conflict when it is already sitting on the table being validated.
  update bookings
  set table_id = null, joined_table_ids = '{}'::uuid[], seat_indices = null
  where id = p_id;

  if p_table_id is null then
    return;
  end if;

  select seats, is_shared into t_seats, t_shared
  from dining_tables
  where id = p_table_id and active
    and not exists (
      select 1 from table_day_overrides c
      where c.table_id = p_table_id and c.date = b.date and c.kind = 'closed'
    );
  if t_seats is null then
    raise exception 'that table is not available on this date';
  end if;
  t_seats := t_seats + coalesce((
    select seats_delta from table_day_overrides
    where table_id = p_table_id and date = b.date and kind = 'seats_delta'
  ), 0);

  if not table_has_room(p_table_id, null, t_seats, t_shared, b.date, b.time, b.party_size) then
    raise exception 'that table is not free at this time';
  end if;

  -- A joined table is always claimed in full, same as a manual join in the
  -- seat picker and the same as the auto-allocator's own combo run: a shared
  -- one must be entirely empty, an exclusive one just unoccupied.
  if p_joined_table_ids is not null then
    foreach jt_id in array p_joined_table_ids loop
      select seats, is_shared into jt_seats, jt_shared
      from dining_tables
      where id = jt_id and active
        and not exists (
          select 1 from table_day_overrides c
          where c.table_id = jt_id and c.date = b.date and c.kind = 'closed'
        );
      if jt_seats is null then
        raise exception 'a joined table is not available on this date';
      end if;
      if not table_has_room(
        jt_id, null, jt_seats, jt_shared, b.date, b.time,
        case when jt_shared then jt_seats else 1 end
      ) then
        raise exception 'a joined table is not free at this time';
      end if;
    end loop;
  end if;

  update bookings set
    table_id         = p_table_id,
    joined_table_ids = coalesce(p_joined_table_ids, '{}'::uuid[]),
    seat_indices      = p_seat_indices
  where id = p_id;
end;
$$;

revoke execute on function assign_booking_seats(uuid, uuid, int[], uuid[]) from public;
grant execute on function assign_booking_seats(uuid, uuid, int[], uuid[]) to authenticated;
