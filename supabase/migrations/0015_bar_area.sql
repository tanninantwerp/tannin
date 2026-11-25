-- A third area, for booking rather than for opening and closing.
--
-- 0011 folded the bar stools and the high table into 'inside', reasoning that
-- nobody opens or closes the bar on its own — there was only ever one switch
-- anybody used, the terrace. That reasoning still holds for the *admin's* Areas
-- panel: it stays two buttons, and closing "inside" still takes the bar with
-- it, because the bar is physically part of the same room.
--
-- What has changed is that guests can now ask for the bar specifically when
-- booking, the same way they can ask for the terrace. Answering that needs
-- 'bar' to be a real, distinct value in `area` — the column `free_slots` and
-- `book_table` can filter on — not just a name pattern. So it comes back as a
-- value, without coming back as a third light switch.
--
-- 'Hoge tafel' moves too, not only the five stools. It is physically the table
-- at the bar, and a "Bar" choice that only ever fits one person would not be a
-- usable choice for the two or three of most parties.

alter table dining_tables drop constraint if exists dining_tables_area_check;
alter table dining_tables
  add constraint dining_tables_area_check check (area in ('inside', 'terrace', 'bar'));

update dining_tables
set area = 'bar'
where name in ('Hoge tafel', 'Barkruk 1', 'Barkruk 2', 'Barkruk 3', 'Barkruk 4', 'Barkruk 5');

-- What the guest actually asked for, kept separate from `table_id`'s area.
-- A party of seven who asked for the terrace and got no table at all is still
-- a party who asked for the terrace — that has to survive being `pending`,
-- which `table_id` cannot carry because it is null in exactly that case.
alter table bookings add column if not exists requested_area text;
alter table bookings drop constraint if exists bookings_requested_area_check;
alter table bookings
  add constraint bookings_requested_area_check
  check (requested_area is null or requested_area in ('inside', 'terrace', 'bar'));

-- ── area-aware availability ─────────────────────────────────────────────────
--
-- `wanted_area` defaults to null, meaning no preference — every existing
-- caller that never mentions an area keeps working exactly as before. Named
-- `wanted_area` rather than `area`, because `area` is also the column name on
-- `dining_tables`: a parameter or plpgsql variable sharing a column's name
-- makes every bare reference to it inside a query ambiguous (Postgres error
-- 42702) — it cannot tell the argument from the column.
--
-- The old signatures are dropped rather than left as overloads, same
-- reasoning as 0009's `in_client`: an overload with no area argument would
-- still be granted to `anon` and would quietly never apply the filter.

drop function if exists free_slots(date, int, time[]);

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

drop function if exists book_table(date, time, int, text, text, text, text, text, text);

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
  -- Silently ignored rather than rejected when it is not one of the three —
  -- the same forgiveness `in_lang` gets, since an unrecognised value here is a
  -- stale client rather than something worth failing the booking over.
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
  -- Not named `area` — see the note above `free_slots` on why that collides
  -- with the column of the same name.
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

revoke execute on function free_slots(date, int, time[], text) from public;
revoke execute on function book_table(date, time, int, text, text, text, text, text, text, text) from public;

grant execute on function free_slots(date, int, time[], text) to anon, authenticated;
grant execute on function book_table(date, time, int, text, text, text, text, text, text, text) to anon, authenticated;
