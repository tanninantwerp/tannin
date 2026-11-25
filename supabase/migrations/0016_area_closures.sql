-- Closing one area for a stretch of dates, not the whole room for one day.
--
-- `blackouts` already closes the venue entirely for a date (or a time window
-- within it) — that is the right tool for a private hire or a holiday, but it
-- is the wrong shape for "the terrace is out until Sunday because of the
-- forecast": every inside and bar table would refuse bookings too, which is
-- not what anyone closing the terrace actually wants.
--
-- A date range rather than one row per day: a staff member closing the
-- terrace for a rainy weekend should say so once, not tap Saturday and Sunday
-- separately and remember to do the same for a three-day forecast.

create table if not exists area_closures (
  id         uuid primary key default gen_random_uuid(),
  area       text not null check (area in ('inside', 'terrace', 'bar')),
  from_date  date not null,
  to_date    date not null,
  reason     text not null,
  created_at timestamptz not null default now(),
  constraint area_closure_range_ok check (to_date >= from_date)
);

create index if not exists area_closures_dates_idx on area_closures (from_date, to_date);

alter table area_closures enable row level security;

-- Never read by the anon key: `free_slots` and `book_table` are
-- `security definer` and consult this table on the guest's behalf without it
-- ever needing its own row visible to them. Only staff with the tables
-- permission see or change it, the same gate as the floor plan itself.
drop policy if exists "tables read area closures" on area_closures;
create policy "tables read area closures" on area_closures for select
  using (has_perm('tables'));
drop policy if exists "tables write area closures" on area_closures;
create policy "tables write area closures" on area_closures for all
  using (has_perm('tables')) with check (has_perm('tables'));

-- ── wire it into availability ────────────────────────────────────────────────
--
-- Same signatures as 0015 — no new parameter, so every existing caller keeps
-- working unchanged. A closed area simply drops out of the table pool for the
-- dates it covers, the same as if every table in it had been switched off.

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
    from dining_tables t
    where t.active
      and t.seats >= party
      and t.min_seats <= party
      and (wanted_area is null or t.area = wanted_area)
      and not exists (
        select 1 from area_closures ac
        where ac.area = t.area and on_date between ac.from_date and ac.to_date
      )
      and not exists (
        select 1
        from bookings b
        where b.table_id = t.id
          and b.date = on_date
          and b.status in ('pending', 'confirmed', 'seated')
          and (on_date + b.time, on_date + b.time + table_turn())
              overlaps
              (on_date + c.slot, on_date + c.slot + table_turn())
      )
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
  chosen       uuid;
  new_status   booking_status;
  lang         text := case when in_lang in ('en', 'nl') then in_lang else 'en' end;
  wanted_area  text := case when in_area in ('inside', 'terrace', 'bar') then in_area else null end;
  keys         text[];
  seen         int;
begin
  if party < 1 or party > 8 then
    raise exception 'party size out of range';
  end if;
  if on_date < current_date or on_date > current_date + 365 then
    raise exception 'date out of range';
  end if;
  if in_name is null or btrim(in_name) = '' or in_email is null or btrim(in_email) = '' then
    raise exception 'name and email are required';
  end if;

  if char_length(btrim(in_name)) > 80 or char_length(btrim(in_email)) > 254
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

  perform pg_advisory_xact_lock(hashtext(on_date::text));

  select t.id into chosen
  from dining_tables t
  where t.active
    and t.seats >= party
    and t.min_seats <= party
    and (wanted_area is null or t.area = wanted_area)
    and not exists (
      select 1 from area_closures ac
      where ac.area = t.area and on_date between ac.from_date and ac.to_date
    )
    and not exists (
      select 1
      from bookings b
      where b.table_id = t.id
        and b.date = on_date
        and b.status in ('pending', 'confirmed', 'seated')
        and (on_date + b.time, on_date + b.time + table_turn())
            overlaps
            (on_date + at_time, on_date + at_time + table_turn())
    )
  order by t.seats asc, t.position asc
  limit 1;

  new_status := case when chosen is null then 'pending' else 'confirmed' end::booking_status;

  insert into booking_throttle (key)
  select unnest(keys);

  return query
  insert into bookings (
    date, time, party_size, guest_name, guest_email,
    guest_phone, notes, locale, status, table_id, requested_area
  )
  values (
    on_date, at_time, party, btrim(in_name), btrim(in_email),
    nullif(btrim(coalesce(in_phone, '')), ''),
    nullif(btrim(coalesce(in_note, '')), ''),
    lang, new_status, chosen, wanted_area
  )
  returning bookings.id, bookings.manage_token, bookings.status;
end;
$$;
