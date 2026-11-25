-- Joining more than two tables for one big party.
--
-- 0027 taught the allocator to push two tables together; 0031 folded every
-- allocation path into one `allocate()`. But the schema still only ever
-- recorded a single partner: `bookings.joined_table_id`, one column, one extra
-- table. A party of eight inside — where the only route there is the four back
-- two-tops pushed into a run — had nowhere to be written, so it fell through to
-- `pending` and a member of staff joined the tables by hand.
--
-- This makes the combo N-way. Three connected changes:
--
--   1. `joined_table_ids uuid[]` replaces `joined_table_id`. A booking still
--      has one primary `table_id`; this is the rest of its run, in floor order.
--      Backfilled from the old column, which is then dropped. An array has no
--      per-element foreign key, so a delete-time trigger takes a removed table
--      back out of every booking's run — the same "the booking survives, it
--      just loses that seat" behaviour the old ON DELETE SET NULL gave.
--
--   2. `combo_tables_for` returns a run, not a pair. Within one connect_group,
--      one area, and — new here — one height (`is_high`), it takes the biggest
--      free pieces first and adds tables until the party is covered, so eight
--      lands as 6+2 where a six-top is free and as 2+2+2+2 where only deuces
--      are. Same height because you cannot physically push a bar-height table
--      against a low one. Least total seats wins across groups, then the run
--      that leaves shared tables free, then the fewest tables.
--
--   3. `allocate` hands back the primary plus the rest of the run as an array;
--      `book_table` and `reschedule_booking` write it to `joined_table_ids`.
--
-- Idempotent: guarded column add with a backfill, functions whose return shape
-- changes are dropped first, the rest are create-or-replace.

-- 1. The array, backfilled from the single column before it goes.
alter table bookings
  add column if not exists joined_table_ids uuid[] not null default '{}'::uuid[];

update bookings
  set joined_table_ids = array[joined_table_id]
  where joined_table_id is not null
    and joined_table_ids = '{}'::uuid[];

-- effective_tables_for grows an is_high column, so it has to be dropped and
-- rebuilt (CREATE OR REPLACE cannot change a table function's column list).
drop function if exists effective_tables_for(date);

create or replace function effective_tables_for(on_date date)
returns table (
  id uuid, override_id uuid, seats int, min_seats int, area text, "position" int,
  is_shared boolean, connect_group text, is_high boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, null::uuid as override_id,
         t.seats + coalesce(d.seats_delta, 0) as seats,
         t.min_seats, t.area, t.position,
         t.is_shared, t.connect_group, t.is_high
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
         o.is_shared, o.connect_group, o.is_high
  from table_day_overrides o
  where o.date = on_date and o.kind = 'adhoc';
$$;

revoke execute on function effective_tables_for(date) from public;

-- A table doubles as "occupied" if it is anybody's primary table or anywhere in
-- their run. Same overlap and buffer maths as 0031; only the run membership
-- test changes from a single column to array membership.
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
        (t_id is not null and (b.table_id = t_id or t_id = any(b.joined_table_ids)))
        or (t_override_id is not null and b.day_override_table_id = t_override_id)
      )
        and b.date = on_date
        and b.status in ('pending', 'confirmed', 'seated')
        and (on_date + b.time, on_date + b.time + party_turn(b.party_size) + reset_buffer())
            overlaps
            (on_date + at_time, on_date + at_time + party_turn(party))
    ), 0) <= t_seats
  else
    not exists (
      select 1
      from bookings b
      where (
        (t_id is not null and (b.table_id = t_id or t_id = any(b.joined_table_ids)))
        or (t_override_id is not null and b.day_override_table_id = t_override_id)
      )
        and b.date = on_date
        and b.status in ('pending', 'confirmed', 'seated')
        and (on_date + b.time, on_date + b.time + party_turn(b.party_size) + reset_buffer())
            overlaps
            (on_date + at_time, on_date + at_time + party_turn(party))
    )
  end;
$$;

revoke execute on function table_has_room(uuid, uuid, int, boolean, date, time, int) from public;

-- The best run of tables for a party nothing single-handedly fits: within one
-- connect_group, one area, one height, take the biggest free pieces first and
-- keep adding until the party is covered. A shared table counts only when it is
-- entirely empty (asking table_has_room for its full seat count is exactly "is
-- anyone here"), matching how 0028 let a combo annex an empty shared table.
--
-- The return shape changes from a pair to an array, so it is dropped first.
drop function if exists combo_tables_for(date, time, int, text);

create or replace function combo_tables_for(on_date date, at_time time, party int, wanted_area text default null)
returns table (table_ids uuid[], total_seats int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  grp        record;
  t          record;
  acc_ids    uuid[];
  acc_seats  int;
  acc_count  int;
  acc_shared int;
  acc_minpos int;
  best_ids    uuid[] := null;
  best_seats  int;
  best_count  int;
  best_shared int;
  best_minpos int;
begin
  -- Each (connect_group, height) run in an allowed, open area is a candidate.
  for grp in
    select distinct e.connect_group, e.is_high, e.area
    from effective_tables_for(on_date) e
    where e.connect_group is not null
      and e.id is not null
      and (wanted_area is null or e.area = wanted_area)
      and not exists (
        select 1 from area_closures ac
        where ac.area = e.area and on_date between ac.from_date and ac.to_date
      )
  loop
    acc_ids := '{}'::uuid[];
    acc_seats := 0;
    acc_count := 0;
    acc_shared := 0;
    acc_minpos := null;

    for t in
      select e.id, e.seats, e.min_seats, e.position, e.is_shared
      from effective_tables_for(on_date) e
      where e.connect_group = grp.connect_group
        and e.is_high = grp.is_high
        and e.area = grp.area
        and e.id is not null
        and party >= e.min_seats
        and table_has_room(e.id, null, e.seats, e.is_shared, on_date, at_time,
                           case when e.is_shared then e.seats else 1 end)
      order by e.seats desc, e.position asc
    loop
      exit when acc_seats >= party;
      acc_ids    := acc_ids || t.id;
      acc_seats  := acc_seats + t.seats;
      acc_count  := acc_count + 1;
      acc_shared := acc_shared + case when t.is_shared then 1 else 0 end;
      acc_minpos := least(coalesce(acc_minpos, t.position), t.position);
    end loop;

    -- Usable only if it covers the party across at least two tables — a single
    -- table would already have been taken by allocate's single-table search.
    if acc_seats >= party and acc_count >= 2 then
      if best_ids is null
         or acc_seats  < best_seats
         or (acc_seats = best_seats and acc_shared < best_shared)
         or (acc_seats = best_seats and acc_shared = best_shared and acc_count < best_count)
         or (acc_seats = best_seats and acc_shared = best_shared and acc_count = best_count
             and acc_minpos < best_minpos) then
        best_ids    := acc_ids;
        best_seats  := acc_seats;
        best_count  := acc_count;
        best_shared := acc_shared;
        best_minpos := acc_minpos;
      end if;
    end if;
  end loop;

  if best_ids is not null then
    -- Ordered by floor position so the primary (element 1) is the earliest
    -- table and the run reads left to right on the map.
    return query
      select array_agg(x.id order by x.position), best_seats
      from (
        select e.id, e.position
        from effective_tables_for(on_date) e
        where e.id = any(best_ids)
      ) x;
  end if;
  return;
end;
$$;

revoke execute on function combo_tables_for(date, time, int, text) from public;

-- One allocation decision: smallest single free table, else the best run.
-- Returns the primary table (or an adhoc override) and the rest of the run.
-- The return shape changes (joined_id uuid -> joined_ids uuid[]), so it is
-- dropped first.
drop function if exists allocate(date, time, int, text, uuid);

create or replace function allocate(
  on_date     date,
  at_time     time,
  party       int,
  wanted_area text default null,
  exclude_id  uuid default null
)
returns table (table_id uuid, override_id uuid, joined_ids uuid[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  chosen_id          uuid;
  chosen_override_id uuid;
  combo_ids          uuid[];
  cap                int;
  slot_start         time;
  booked             int;
begin
  -- Pacing first: an arrival window already at its cap has no availability,
  -- whatever the tables could physically seat.
  select pace_covers into cap from booking_settings limit 1;
  if cap is not null then
    slot_start := make_time(
      extract(hour from at_time)::int,
      (floor(extract(minute from at_time) / 15) * 15)::int,
      0
    );
    select coalesce(sum(b.party_size), 0) into booked
    from bookings b
    where b.date = on_date
      and b.status in ('pending', 'confirmed', 'seated')
      and (exclude_id is null or b.id <> exclude_id)
      and b.time >= slot_start
      and b.time < slot_start + interval '15 minutes';
    if booked + party > cap then
      return query select null::uuid, null::uuid, '{}'::uuid[];
      return;
    end if;
  end if;

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

  if chosen_id is not null or chosen_override_id is not null then
    return query select chosen_id, chosen_override_id, '{}'::uuid[];
    return;
  end if;

  select c.table_ids into combo_ids
  from combo_tables_for(on_date, at_time, party, wanted_area) c;

  if combo_ids is not null and array_length(combo_ids, 1) >= 1 then
    return query select combo_ids[1], null::uuid,
                        combo_ids[2:array_length(combo_ids, 1)];
  else
    return query select null::uuid, null::uuid, '{}'::uuid[];
  end if;
end;
$$;

revoke execute on function allocate(date, time, int, text, uuid) from public;

-- Now just "does allocate find anything for this slot".
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
    select 1 from allocate(on_date, c.slot, party, wanted_area) a
    where a.table_id is not null or a.override_id is not null
  )
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
  combo_ids          uuid[];
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

  select a.table_id, a.override_id, a.joined_ids
  into chosen_id, chosen_override_id, combo_ids
  from allocate(on_date, at_time, party, wanted_area) a;

  new_status := case
    when chosen_id is not null or chosen_override_id is not null then 'confirmed' else 'pending'
  end::booking_status;

  if not staff_caller then
    insert into booking_throttle (key)
    select unnest(keys);
  end if;

  return query
  insert into bookings (
    date, time, party_size, guest_name, guest_email,
    guest_phone, notes, locale, status, table_id, joined_table_ids, day_override_table_id, requested_area
  )
  values (
    on_date, at_time, party, btrim(in_name), nullif(btrim(coalesce(in_email, '')), ''),
    nullif(btrim(coalesce(in_phone, '')), ''),
    nullif(btrim(coalesce(in_note, '')), ''),
    lang, new_status, chosen_id, coalesce(combo_ids, '{}'::uuid[]), chosen_override_id, wanted_area
  )
  returning bookings.id, bookings.manage_token, bookings.status;
end;
$$;

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
  combo_ids          uuid[];
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

  -- Step the booking out of the way so it does not block itself.
  update bookings
  set table_id = null, joined_table_ids = '{}'::uuid[], seat_indices = null
  where id = p_id;

  select a.table_id, a.override_id, a.joined_ids
  into chosen_id, chosen_override_id, combo_ids
  from allocate(p_date, p_time, p_party, wanted_area, p_id) a;

  new_status := case
    when chosen_id is not null or chosen_override_id is not null then 'confirmed' else 'pending'
  end::booking_status;

  update bookings set
    date                  = p_date,
    time                  = p_time,
    party_size            = p_party,
    requested_area        = wanted_area,
    table_id              = chosen_id,
    joined_table_ids      = coalesce(combo_ids, '{}'::uuid[]),
    day_override_table_id = chosen_override_id,
    status                = new_status,
    cancelled_by          = null
  where id = p_id;

  return new_status;
end;
$$;

-- The old single column is gone; everything now reads the array.
alter table bookings drop column if exists joined_table_id;

-- An array element has no foreign key, so deleting a table cannot cascade into
-- it. This does by hand what ON DELETE SET NULL did for the old column: take
-- the removed table out of every run it was part of, leaving those bookings
-- otherwise intact.
create or replace function scrub_deleted_table_from_runs()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update bookings
    set joined_table_ids = array_remove(joined_table_ids, old.id)
    where old.id = any(joined_table_ids);
  return old;
end;
$$;

drop trigger if exists scrub_deleted_table_from_runs on dining_tables;
create trigger scrub_deleted_table_from_runs
  after delete on dining_tables
  for each row execute function scrub_deleted_table_from_runs();
