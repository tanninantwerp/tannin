-- Two allocator behaviours the schema already implied but never ran:
--
--   is_shared     — added in 0017 with the comment "its open chairs are
--                   offered to other parties of two-plus once it already
--                   holds a booking". Nothing ever read the column; a party
--                   of 2 booking the 14-seat Long table locked all 14 chairs,
--                   same as any other table. Now a shared table accepts more
--                   bookings up to its seat count instead of going exclusive
--                   the moment it holds one.
--   connect_group — added in 0020 for the floor-plan renderer ("tables that
--                   push together into one bookable run"). Now the allocator
--                   reads it too: when a party is too big for any single free
--                   table, two free, non-shared tables in the same group are
--                   offered together, both booked to the one party.
--
-- `joined_table_id` is the new piece: a booking still has one primary
-- `table_id`, plus this second table when it was seated across a pair.
-- Nullable, set only by a combo pick — every booking before this migration,
-- and every one that fits a single table, leaves it null. On delete it
-- behaves like `table_id` already does: the booking survives, it just loses
-- that seat.
--
-- Idempotent: the column add is guarded, `effective_tables_for` is dropped
-- first because its return columns are growing (CREATE OR REPLACE cannot
-- change a table function's column list), and everything else is a plain
-- create-or-replace.

alter table bookings
  add column if not exists joined_table_id uuid references dining_tables (id) on delete set null;

drop function if exists effective_tables_for(date);

create or replace function effective_tables_for(on_date date)
returns table (
  id uuid, override_id uuid, seats int, min_seats int, area text, "position" int,
  is_shared boolean, connect_group text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, null::uuid as override_id,
         t.seats + coalesce(d.seats_delta, 0) as seats,
         t.min_seats, t.area, t.position,
         t.is_shared, t.connect_group
  from dining_tables t
  left join table_day_overrides d
    on d.table_id = t.id and d.date = on_date and d.kind = 'seats_delta'
  where t.active
    and not exists (
      select 1 from table_day_overrides c
      where c.table_id = t.id and c.date = on_date and c.kind = 'closed'
    )
  union all
  select null::uuid as id, o.id as override_id,
         o.seats, o.min_seats, o.area, 9999 as "position",
         o.is_shared, o.connect_group
  from table_day_overrides o
  where o.date = on_date and o.kind = 'adhoc';
$$;

revoke execute on function effective_tables_for(date) from public;

-- Whether a table is free for one slot: exclusive tables ask "does anything
-- overlap"; shared tables ask "is there still room". A table doubles as
-- "occupied" for this purpose if it is anything's `table_id` or its
-- `joined_table_id` — the second table of somebody else's combo is not free
-- to hand out again.
create or replace function table_has_room(
  t_id          uuid,
  t_override_id uuid,
  t_seats       int,
  t_is_shared   boolean,
  on_date       date,
  at_time       time,
  party         int
)
returns boolean
language sql
stable
set search_path = public
as $$
  select case when t_is_shared then
    party + coalesce((
      select sum(b.party_size)
      from bookings b
      where (
        (t_id is not null and (b.table_id = t_id or b.joined_table_id = t_id))
        or (t_override_id is not null and b.day_override_table_id = t_override_id)
      )
        and b.date = on_date
        and b.status in ('pending', 'confirmed', 'seated')
        and (on_date + b.time, on_date + b.time + table_turn())
            overlaps
            (on_date + at_time, on_date + at_time + table_turn())
    ), 0) <= t_seats
  else
    not exists (
      select 1
      from bookings b
      where (
        (t_id is not null and (b.table_id = t_id or b.joined_table_id = t_id))
        or (t_override_id is not null and b.day_override_table_id = t_override_id)
      )
        and b.date = on_date
        and b.status in ('pending', 'confirmed', 'seated')
        and (on_date + b.time, on_date + b.time + table_turn())
            overlaps
            (on_date + at_time, on_date + at_time + table_turn())
    )
  end;
$$;

revoke execute on function table_has_room(uuid, uuid, int, boolean, date, time, int) from public;

-- The best pair of joined tables for a party nothing single-handedly fits:
-- same connect_group, same area, both exclusive (a shared table's spare
-- chairs are offered individually, not annexed into somebody else's combo),
-- both free for the slot, seats between them covering the party. Smallest
-- combined total wins, so a big party doesn't take the room's largest pair
-- when a smaller one would do.
--
-- Two extra guards keep this "too big for one, not just any excuse to
-- annex a second table":
--   party > least(a.seats, b.seats)   — genuinely doesn't fit the smaller of
--                                        the pair alone, or the single-table
--                                        search above would already have used
--                                        just that one.
--   party >= greatest(a.min_seats, b.min_seats) — never combos two tables
--                                        for a party too small even for one
--                                        of them on its own (a solo guest in
--                                        an area where every table requires
--                                        2+ must still come back pending,
--                                        not get handed two tables).
--
-- Dropped first, not just replaced: a later migration widens the return to a
-- run of N tables, and CREATE OR REPLACE cannot change a return type — so on a
-- second paste of the whole setup this has to be able to recreate the pair
-- shape over that later one.
drop function if exists combo_tables_for(date, time, int, text);

create or replace function combo_tables_for(on_date date, at_time time, party int, wanted_area text default null)
returns table (table_a uuid, table_b uuid, total_seats int)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, b.id, a.seats + b.seats
  from effective_tables_for(on_date) a
  join effective_tables_for(on_date) b
    on b.connect_group = a.connect_group
   and b.id > a.id
  where a.id is not null and b.id is not null
    and a.connect_group is not null
    and a.is_shared = false and b.is_shared = false
    and a.area = b.area
    and (wanted_area is null or a.area = wanted_area)
    and a.seats + b.seats >= party
    and party > least(a.seats, b.seats)
    and party >= greatest(a.min_seats, b.min_seats)
    and not exists (
      select 1 from area_closures ac
      where ac.area = a.area and on_date between ac.from_date and ac.to_date
    )
    and table_has_room(a.id, null, a.seats, false, on_date, at_time, 1)
    and table_has_room(b.id, null, b.seats, false, on_date, at_time, 1)
  -- `b.id > a.id` above only dedupes each unordered pair to one row; it does
  -- not mean `a` is the earlier table on the floor. Break ties on the pair's
  -- own positions, not on which side of the join UUID order happened to put
  -- a given table, or a group of more than two equally-sized tables (the
  -- back four, all 2 seats) would hand out a different, arbitrary pair every
  -- time two runs happen to hash their ids in a different order.
  order by (a.seats + b.seats) asc, least(a.position, b.position) asc, greatest(a.position, b.position) asc
  limit 1;
$$;

revoke execute on function combo_tables_for(date, time, int, text) from public;

create or replace function free_slots(on_date date, party int, candidates time[], wanted_area text default null)
returns table (slot time)
language sql
stable
security definer
set search_path = public
as $$
  select c.slot
  from unnest(candidates) as c(slot)
  where exists (
    select 1
    from effective_tables_for(on_date) t
    where t.seats >= party
      and t.min_seats <= party
      and (wanted_area is null or t.area = wanted_area)
      and not exists (
        select 1 from area_closures ac
        where ac.area = t.area and on_date between ac.from_date and ac.to_date
      )
      and table_has_room(t.id, t.override_id, t.seats, t.is_shared, on_date, c.slot, party)
  )
  or exists (select 1 from combo_tables_for(on_date, c.slot, party, wanted_area))
  order by c.slot;
$$;

create or replace function book_table(
  on_date   date,
  at_time   time,
  party     int,
  in_name   text,
  in_email  text,
  in_phone  text default null,
  in_note   text default null,
  in_lang   text default 'en',
  in_client text default null,
  in_area   text default null
)
returns table (id uuid, manage_token uuid, status booking_status)
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
  new_status         booking_status;
  lang               text := case when in_lang in ('en', 'nl') then in_lang else 'en' end;
  wanted_area        text := case when in_area in ('inside', 'terrace', 'bar') then in_area else null end;
  keys                text[];
  seen                int;
  staff_caller        boolean := is_staff();
begin
  if party < 1 or party > 8 then
    raise exception 'party size out of range';
  end if;
  if on_date < current_date or on_date > current_date + 365 then
    raise exception 'date out of range';
  end if;
  if in_name is null or btrim(in_name) = '' then
    raise exception 'name is required';
  end if;
  if not staff_caller and (in_email is null or btrim(in_email) = '') then
    raise exception 'name and email are required';
  end if;

  if char_length(btrim(in_name)) > 80 or char_length(coalesce(btrim(in_email), '')) > 254
     or char_length(coalesce(btrim(in_phone), '')) > 32
     or char_length(coalesce(btrim(in_note), '')) > 500 then
    raise exception 'field too long';
  end if;

  if exists (
    select 1 from blackouts bl
    where bl.date = on_date
      and (bl."from" is null or (at_time >= bl."from" and at_time < bl."to"))
  ) then
    raise exception 'closed at that time';
  end if;

  if not staff_caller then
    delete from booking_throttle where at < now() - throttle_window();

    keys := array_remove(
      array[
        'email:' || lower(btrim(in_email)),
        'ip:' || nullif(btrim(coalesce(in_client, '')), '')
      ]::text[],
      null::text
    );

    select count(*) into seen
    from booking_throttle t
    where t.key = any (keys);

    if seen >= throttle_max() then
      raise exception 'too many bookings from this source'
        using errcode = 'TN001';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(on_date::text));

  select t.id, t.override_id into chosen_id, chosen_override_id
  from effective_tables_for(on_date) t
  where t.seats >= party
    and t.min_seats <= party
    and (wanted_area is null or t.area = wanted_area)
    and not exists (
      select 1 from area_closures ac
      where ac.area = t.area and on_date between ac.from_date and ac.to_date
    )
    and table_has_room(t.id, t.override_id, t.seats, t.is_shared, on_date, at_time, party)
  order by t.seats asc, t.position asc
  limit 1;

  if chosen_id is null and chosen_override_id is null then
    select c.table_a, c.table_b into combo_a, combo_b
    from combo_tables_for(on_date, at_time, party, wanted_area) c;
  end if;

  new_status := case
    when chosen_id is not null or chosen_override_id is not null or combo_a is not null
      then 'confirmed' else 'pending'
  end::booking_status;

  if not staff_caller then
    insert into booking_throttle (key)
    select unnest(keys);
  end if;

  return query
  insert into bookings (
    date, time, party_size, guest_name, guest_email,
    guest_phone, notes, locale, status, table_id, joined_table_id, day_override_table_id, requested_area
  )
  values (
    on_date, at_time, party, btrim(in_name), nullif(btrim(coalesce(in_email, '')), ''),
    nullif(btrim(coalesce(in_phone, '')), ''),
    nullif(btrim(coalesce(in_note, '')), ''),
    lang, new_status, coalesce(chosen_id, combo_a), combo_b, chosen_override_id, wanted_area
  )
  returning bookings.id, bookings.manage_token, bookings.status;
end;
$$;
