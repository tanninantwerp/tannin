-- Automatic confirmation, on a real table plan.
--
-- Until now a booking was a request: the website could not see how full the
-- room was, because the anon key cannot read the guest book and giving it that
-- power to answer "is 19:30 free" would hand it every guest's name and email.
--
-- The way out is the same one the manage token uses. Security-definer functions
-- see past row-level security, but these two only ever return *availability* —
-- never a name, never an address, never so much as a count of who is booked.
-- The guest book stays unreadable; the answer to "is there a table" does not.
--
-- Note what is NOT in here: opening hours. Those live in packages/core, in
-- SERVICE_WINDOWS, and duplicating them in SQL would guarantee the two drift.
-- The app works out which times it is willing to offer and passes them in;
-- Postgres only says which of those still have a table free.

create table if not exists dining_tables (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  seats     int  not null check (seats between 1 and 20),
  -- Stops a couple being seated at the eight-top while four people are turned
  -- away. Set it equal to `seats` for a table that should never be shared down.
  min_seats int  not null default 1 check (min_seats >= 1),
  area      text not null default 'inside',
  active    boolean not null default true,
  position  int  not null default 0,
  constraint seats_gte_min check (seats >= min_seats)
);

alter table bookings
  add column if not exists table_id uuid references dining_tables (id) on delete set null;

create index if not exists bookings_date_table_idx on bookings (date, table_id);

alter table dining_tables enable row level security;

-- The plan itself is not a secret — it is the furniture. Who is sitting at it
-- is, and that lives in `bookings`.
drop policy if exists "tables are public" on dining_tables;
create policy "tables are public" on dining_tables for select using (active);
drop policy if exists "staff write tables" on dining_tables;
create policy "staff write tables" on dining_tables for all using (is_staff()) with check (is_staff());

-- ── how long a table is held ────────────────────────────────────────────────
-- Mirrors TABLE_TURN_MINUTES in packages/core. If that changes, change this.
create or replace function table_turn() returns interval
language sql immutable as $$ select interval '105 minutes' $$;

/**
 * Which of the offered times still have a table for this many people.
 *
 * Takes the candidate slots rather than working them out, so opening hours stay
 * defined in exactly one place. Returns times and nothing else.
 */
create or replace function free_slots(on_date date, party int, candidates time[])
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
      and not exists (
        select 1
        from bookings b
        where b.table_id = t.id
          and b.date = on_date
          -- Cancelled and no-show free the table back up; seated does not.
          and b.status in ('pending', 'confirmed', 'seated')
          -- Built as timestamps, not times: 23:30 plus a turn is tomorrow, and
          -- time arithmetic would wrap it round to 01:15 and call it free.
          and (on_date + b.time, on_date + b.time + table_turn())
              overlaps
              (on_date + c.slot, on_date + c.slot + table_turn())
      )
  )
  order by c.slot;
$$;

/**
 * Books a table, allocating one if it can.
 *
 * Confirms outright when a single table fits the party. When none does — a
 * party of seven with nothing bigger than a six — it still records the request
 * as `pending`, because that is a table Tawat can probably make by pushing two
 * together, and it is a decision for a person rather than a rule.
 *
 * The advisory lock is the whole point. Without it, two people hitting Book at
 * the same instant both see the last table free and both take it.
 */
create or replace function book_table(
  on_date  date,
  at_time  time,
  party    int,
  in_name  text,
  in_email text,
  in_phone text default null,
  in_note  text default null,
  in_lang  text default 'en'
)
returns table (id uuid, manage_token uuid, status booking_status)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  chosen     uuid;
  new_status booking_status;
  lang       text := case when in_lang in ('en', 'nl') then in_lang else 'en' end;
begin
  -- The same limits the row-level security policy enforces on a direct insert.
  -- This function bypasses that policy, so it has to carry the rules itself.
  if party < 1 or party > 8 then
    raise exception 'party size out of range';
  end if;
  if on_date < current_date or on_date > current_date + 365 then
    raise exception 'date out of range';
  end if;
  if in_name is null or btrim(in_name) = '' or in_email is null or btrim(in_email) = '' then
    raise exception 'name and email are required';
  end if;

  -- A closed day, or a closed stretch of one.
  if exists (
    select 1 from blackouts bl
    where bl.date = on_date
      and (bl."from" is null or (at_time >= bl."from" and at_time < bl."to"))
  ) then
    raise exception 'closed at that time';
  end if;

  -- Serialises every booking attempt for this date. Held until the transaction
  -- ends, which is the insert below.
  perform pg_advisory_xact_lock(hashtext(on_date::text));

  select t.id into chosen
  from dining_tables t
  where t.active
    and t.seats >= party
    and t.min_seats <= party
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
  -- Smallest table that fits, so a party of two does not consume the six-top.
  order by t.seats asc, t.position asc
  limit 1;

  new_status := case when chosen is null then 'pending' else 'confirmed' end::booking_status;

  return query
  insert into bookings (
    date, time, party_size, guest_name, guest_email,
    guest_phone, notes, locale, status, table_id
  )
  values (
    on_date, at_time, party, btrim(in_name), btrim(in_email),
    nullif(btrim(coalesce(in_phone, '')), ''),
    nullif(btrim(coalesce(in_note, '')), ''),
    lang, new_status, chosen
  )
  returning bookings.id, bookings.manage_token, bookings.status;
end;
$$;

revoke execute on function free_slots(date, int, time[]) from public;
revoke execute on function book_table(date, time, int, text, text, text, text, text) from public;

grant execute on function free_slots(date, int, time[]) to anon, authenticated;
grant execute on function book_table(date, time, int, text, text, text, text, text) to anon, authenticated;

-- ── a starting table plan ───────────────────────────────────────────────────
--
-- PLACEHOLDER. These are invented to add up to roughly the 40 covers the room
-- is reckoned to seat; they are not Ta-nnin's actual furniture. Correct them on
-- the admin's Tables screen before this goes live, or the site will confirm
-- bookings against a floor plan that does not exist.
insert into dining_tables (name, seats, min_seats, area, position)
select * from (values
  ('T1',  2, 1, 'inside',  1),
  ('T2',  2, 1, 'inside',  2),
  ('T3',  2, 1, 'inside',  3),
  ('T4',  2, 1, 'inside',  4),
  ('T5',  4, 2, 'inside',  5),
  ('T6',  4, 2, 'inside',  6),
  ('T7',  4, 2, 'inside',  7),
  ('T8',  4, 3, 'inside',  8),
  ('H1',  6, 4, 'inside',  9),
  ('H2',  6, 4, 'inside', 10)
) as seed(name, seats, min_seats, area, position)
where not exists (select 1 from dining_tables);
