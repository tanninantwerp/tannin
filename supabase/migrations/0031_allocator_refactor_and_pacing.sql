-- One place that decides who gets a table, and three controls a real kitchen
-- wants.
--
-- Until now the allocation decision — smallest single table that fits, else a
-- joined pair — was written out three times: in book_table, in
-- reschedule_booking, and (as a yes/no) in free_slots. Three copies of the rule
-- the website's picker and the booker both depend on, which is exactly how the
-- picker comes to offer a slot the booker then refuses. This folds it into one
-- `allocate()`; the other three call it, so they cannot drift.
--
-- With that in place, three settings that were impractical to add across three
-- copies become one-line changes, and all default to today's behaviour so
-- nothing moves until staff choose to:
--   pace_covers          — a cap on covers arriving in the same 15-minute
--                          window, so the kitchen is not handed forty covers at
--                          once. Null = no cap (the default).
--   turn_minutes_large   — a longer turn for a big party than a deuce, taking
--                          effect at large_party_threshold. Defaults equal to
--                          the base turn, i.e. one turn for everyone as before.
--   buffer_minutes       — a gap after a booking before its table can be re-sat,
--                          to reset it. Defaults to 0.
--
-- Idempotent: guarded column adds with a backfill, and create-or-replace
-- functions throughout.

alter table booking_settings
  add column if not exists turn_minutes_large    int,
  add column if not exists large_party_threshold int not null default 5 check (large_party_threshold between 1 and 8),
  add column if not exists buffer_minutes        int not null default 0 check (buffer_minutes between 0 and 120),
  add column if not exists pace_covers           int check (pace_covers is null or pace_covers between 1 and 1000);

-- A big-party turn that starts life equal to the one turn there always was.
update booking_settings set turn_minutes_large = turn_minutes where turn_minutes_large is null;
-- Guarded: ADD CONSTRAINT has no IF NOT EXISTS, so a second paste would trip.
do $$ begin
  alter table booking_settings
    add constraint booking_settings_turn_large_ck
    check (turn_minutes_large is null or turn_minutes_large between 30 and 300);
exception when duplicate_object then null; end $$;

-- How long a party of this size holds a table. `table_turn()` (0007) stays for
-- anything still calling it; this is the size-aware version the occupancy check
-- now uses.
create or replace function party_turn(party int)
returns interval
language sql
stable
set search_path = public
as $$
  select make_interval(mins => (
    select case
             when party >= large_party_threshold then coalesce(turn_minutes_large, turn_minutes)
             else turn_minutes
           end
    from booking_settings limit 1
  ));
$$;

-- The reset gap added after a booking before its table frees up.
create or replace function reset_buffer()
returns interval
language sql
stable
set search_path = public
as $$
  select make_interval(mins => (select buffer_minutes from booking_settings limit 1));
$$;

-- Whether a table is free for one slot. Unchanged in shape from 0027, but each
-- side of the overlap now uses that booking's own party-size turn, and the
-- existing booking's block is extended by the reset buffer so a table is not
-- re-sat inside its own turnaround.
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
        and (on_date + b.time, on_date + b.time + party_turn(b.party_size) + reset_buffer())
            overlaps
            (on_date + at_time, on_date + at_time + party_turn(party))
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
        and (on_date + b.time, on_date + b.time + party_turn(b.party_size) + reset_buffer())
            overlaps
            (on_date + at_time, on_date + at_time + party_turn(party))
    )
  end;
$$;

revoke execute on function table_has_room(uuid, uuid, int, boolean, date, time, int) from public;

-- The one allocation decision: the smallest single table that fits and is free,
-- else the best joined pair. Returns the primary table (or an adhoc override),
-- and the second table when it took a pair. A row of nulls means nothing fit.
--
-- `exclude_id` is for rescheduling: the booking being moved must not count
-- against its own new pacing window.
--
-- Dropped first, not just replaced: a later migration widens `joined_id` to a
-- `joined_ids` array, and CREATE OR REPLACE cannot change a return type — so on
-- a second paste of the whole setup this has to be able to recreate the single
-- shape over that later one.
drop function if exists allocate(date, time, int, text, uuid);

create or replace function allocate(
  on_date     date,
  at_time     time,
  party       int,
  wanted_area text default null,
  exclude_id  uuid default null
)
returns table (table_id uuid, override_id uuid, joined_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  chosen_id          uuid;
  chosen_override_id uuid;
  combo_a            uuid;
  combo_b            uuid;
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
      return query select null::uuid, null::uuid, null::uuid;
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

  if chosen_id is null and chosen_override_id is null then
    select c.table_a, c.table_b into combo_a, combo_b
    from combo_tables_for(on_date, at_time, party, wanted_area) c;
  end if;

  return query select coalesce(chosen_id, combo_a), chosen_override_id, combo_b;
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

  select a.table_id, a.override_id, a.joined_id
  into chosen_id, chosen_override_id, combo_b
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
    guest_phone, notes, locale, status, table_id, joined_table_id, day_override_table_id, requested_area
  )
  values (
    on_date, at_time, party, btrim(in_name), nullif(btrim(coalesce(in_email, '')), ''),
    nullif(btrim(coalesce(in_phone, '')), ''),
    nullif(btrim(coalesce(in_note, '')), ''),
    lang, new_status, chosen_id, combo_b, chosen_override_id, wanted_area
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

  -- Step the booking out of the way so it does not block itself.
  update bookings
  set table_id = null, joined_table_id = null, seat_indices = null
  where id = p_id;

  select a.table_id, a.override_id, a.joined_id
  into chosen_id, chosen_override_id, combo_b
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
    joined_table_id       = combo_b,
    day_override_table_id = chosen_override_id,
    status                = new_status,
    cancelled_by          = null
  where id = p_id;

  return new_status;
end;
$$;
