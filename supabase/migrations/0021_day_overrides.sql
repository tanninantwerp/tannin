-- Forcing a change onto one night, without touching the permanent plan.
--
-- Three shapes, one table:
--   seats_delta — a real table gets extra (or fewer) chairs for one date. The
--                 table itself is untouched; the delta only applies on that day.
--   closed      — a real table comes out of the pool for one date, finer-grained
--                 than `active` (permanent) or `area_closures` (a whole area).
--   adhoc       — a table that only exists for one date: a pop-up for a private
--                 event, seated and positioned like any other, but never written
--                 into `dining_tables` at all.
--
-- A booking against an adhoc table has nothing in `dining_tables` to point at,
-- so it gets its own foreign key alongside the existing one — `table_id` for a
-- real table, `day_override_table_id` for an adhoc one, never both.

create table if not exists table_day_overrides (
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  kind           text not null check (kind in ('seats_delta', 'closed', 'adhoc')),
  table_id       uuid references dining_tables (id),
  seats_delta    int,
  -- adhoc-only: the table's own definition, shaped like dining_tables' bookable
  -- and rendering columns because it stands in for one everywhere those do.
  name           text,
  seats          int,
  min_seats      int not null default 1,
  area           text check (area in ('inside', 'terrace', 'bar')),
  x              int,
  y              int,
  w              int,
  h              int,
  is_high        boolean not null default false,
  is_shared      boolean not null default false,
  vertical       boolean not null default false,
  one_row        boolean not null default false,
  flip_row       boolean not null default false,
  ends           boolean not null default false,
  connect_group  text,
  created_at     timestamptz not null default now(),
  constraint override_shape_ok check (
    (kind = 'seats_delta' and table_id is not null and seats_delta is not null and name is null)
    or (kind = 'closed' and table_id is not null and name is null)
    or (kind = 'adhoc' and table_id is null and name is not null and seats is not null and area is not null)
  )
);

-- At most one seats_delta or closed override per table per date — two would be
-- ambiguous about which applies, and neither makes sense stacked with the other.
create unique index if not exists table_day_overrides_table_date_idx
  on table_day_overrides (table_id, date) where table_id is not null;

create index if not exists table_day_overrides_date_idx on table_day_overrides (date);

alter table bookings
  add column if not exists day_override_table_id uuid references table_day_overrides (id);

alter table table_day_overrides enable row level security;

-- Same gate as the floor plan and area_closures: never exposed to anon, and
-- staff without `tables` see nothing here either.
drop policy if exists "tables read day overrides" on table_day_overrides;
create policy "tables read day overrides" on table_day_overrides for select
  using (has_perm('tables'));
drop policy if exists "tables write day overrides" on table_day_overrides;
create policy "tables write day overrides" on table_day_overrides for all
  using (has_perm('tables')) with check (has_perm('tables'));

-- ── the effective pool for one date ─────────────────────────────────────────
--
-- What free_slots and book_table actually search, instead of dining_tables
-- directly: every active real table (seats adjusted by any seats_delta for
-- that date, dropped entirely if closed for that date), plus that date's
-- adhoc tables. `id` is set for a real table, `override_id` for an adhoc one
-- — exactly one of the two, mirroring bookings' table_id/day_override_table_id
-- split.
--
-- security definer and not granted to anon/authenticated: it reads
-- table_day_overrides, which RLS otherwise keeps to staff, and it is only
-- ever called from inside the two functions that already have their own
-- grants. Revoked from public explicitly because Postgres grants EXECUTE on a
-- new function to public by default.
--
-- Dropped first, not just replaced: 0027 widens this function's return
-- columns, and a later migration's own `create or replace` cannot change an
-- existing function's return type. Pasting the whole bundle a second time
-- replays this definition too, against a database 0027 already widened —
-- without the drop, that replay is the one that fails, not 0027's.
drop function if exists effective_tables_for(date);

create or replace function effective_tables_for(on_date date)
returns table (
  id uuid, override_id uuid, seats int, min_seats int, area text, "position" int
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, null::uuid as override_id,
         t.seats + coalesce(d.seats_delta, 0) as seats,
         t.min_seats, t.area, t.position
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
         o.seats, o.min_seats, o.area, 9999 as "position"
  from table_day_overrides o
  where o.date = on_date and o.kind = 'adhoc';
$$;

revoke execute on function effective_tables_for(date) from public;

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
      and not exists (
        select 1
        from bookings b
        where (
          (t.id is not null and b.table_id = t.id)
          or (t.override_id is not null and b.day_override_table_id = t.override_id)
        )
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
  chosen_id          uuid;
  chosen_override_id uuid;
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
    and not exists (
      select 1
      from bookings b
      where (
        (t.id is not null and b.table_id = t.id)
        or (t.override_id is not null and b.day_override_table_id = t.override_id)
      )
        and b.date = on_date
        and b.status in ('pending', 'confirmed', 'seated')
        and (on_date + b.time, on_date + b.time + table_turn())
            overlaps
            (on_date + at_time, on_date + at_time + table_turn())
    )
  order by t.seats asc, t.position asc
  limit 1;

  new_status := case when chosen_id is null and chosen_override_id is null then 'pending' else 'confirmed' end::booking_status;

  if not staff_caller then
    insert into booking_throttle (key)
    select unnest(keys);
  end if;

  return query
  insert into bookings (
    date, time, party_size, guest_name, guest_email,
    guest_phone, notes, locale, status, table_id, day_override_table_id, requested_area
  )
  values (
    on_date, at_time, party, btrim(in_name), nullif(btrim(coalesce(in_email, '')), ''),
    nullif(btrim(coalesce(in_phone, '')), ''),
    nullif(btrim(coalesce(in_note, '')), ''),
    lang, new_status, chosen_id, chosen_override_id, wanted_area
  )
  returning bookings.id, bookings.manage_token, bookings.status;
end;
$$;
