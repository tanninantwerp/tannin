-- A limit on how fast one stranger can book.
--
-- 0006 made the website confirm tables by itself, which is the right thing for
-- a guest at half eleven at night and a bad thing to leave unattended: a script
-- can now take every table in the diary for a month, in about a second, with no
-- human ever seeing it. Before automatic confirmation the worst it could do was
-- create a pile of requests somebody would notice and delete. Now it takes the
-- room.
--
-- It would also empty the Resend allowance on the way past — every booking
-- sends a receipt, and the free tier is a hundred a day. So one flood costs the
-- bar its tables and its ability to tell anybody about it.
--
-- The threat here is not a determined attacker; nobody is targeting a wine bar
-- in Antwerp with a botnet. It is a bored person, a retry loop that got stuck,
-- or somebody double-clicking Book on a slow train. A per-source counter stops
-- all three, and the first of them has to work at it.

-- ── what the fields may hold ────────────────────────────────────────────────
--
-- `text` in Postgres has no length. Nothing between the form and the table said
-- otherwise, so a megabyte of notes would have been stored, mailed to the bar
-- and rendered on the board.
--
-- These are the real ceiling. FIELD_LIMITS in packages/core mirrors them so the
-- form can complain while the guest is still typing, but this is the one that
-- cannot be talked past — change it here first.
-- Dropped first so this file can be pasted twice without complaining. There is
-- no `add constraint if not exists`, and somebody re-running the setup because
-- they lost track of what they had run is the likeliest way this ever gets
-- read a second time.
alter table bookings
  drop constraint if exists guest_name_length,
  drop constraint if exists guest_email_length,
  drop constraint if exists guest_phone_length,
  drop constraint if exists notes_length;

alter table bookings
  add constraint guest_name_length  check (char_length(guest_name)  <= 80),
  -- The longest a mailbox may be under RFC 5321.
  add constraint guest_email_length check (char_length(guest_email) <= 254),
  add constraint guest_phone_length check (guest_phone is null or char_length(guest_phone) <= 32),
  add constraint notes_length       check (notes is null or char_length(notes) <= 500);

-- ── the counter ─────────────────────────────────────────────────────────────
--
-- One row per booking that went through, keyed by where it came from. Two kinds
-- of key are recorded for each: the guest's address, and a hash of the caller's
-- IP. Neither alone is enough — an address is free to change, and a household
-- behind one router shares an IP — but a flood has to get past both.
--
-- The IP is hashed before it ever arrives here, by the route, with a secret
-- this database does not hold. That is deliberate: a visitor's address is
-- personal data, we do not need it, and the only question we ever ask of it is
-- "is this the same one again", which a hash answers perfectly well. If the
-- secret is not configured the route sends no IP key at all rather than an
-- unsalted hash, which for a 32-bit address space would be reversible in
-- seconds and so no better than storing the address itself.
create table if not exists booking_throttle (
  key text        not null,
  at  timestamptz not null default now()
);

create index if not exists booking_throttle_key_idx on booking_throttle (key, at desc);

-- No policies, on purpose. Row-level security with nothing granted denies
-- everybody; the only thing that reads this table is `book_table`, which is
-- security definer and so sees past it. Nobody can query how often a given
-- address has booked, which is exactly right — it is the only place in the
-- schema where the answer would be visible without reading the guest book.
alter table booking_throttle enable row level security;

-- ── how much is too much ────────────────────────────────────────────────────
--
-- Six an hour. High enough that nobody booking tables for real ever meets it —
-- a family sorting out a birthday might make three attempts, a hotel concierge
-- on one office connection perhaps four — and low enough that filling the
-- diary stops being something you can do while the kettle boils.
--
-- Not in `booking_settings` with the turn time, because that table is for
-- judgements Tawat should be making. This is a safety rail, and a safety rail
-- somebody can raise from a web form is one an attacker can raise too.
create or replace function throttle_window() returns interval
language sql immutable as $$ select interval '1 hour' $$;

create or replace function throttle_max() returns int
language sql immutable as $$ select 6 $$;

-- ── booking, with the rail on ───────────────────────────────────────────────
--
-- The old signature has to go rather than be replaced. A new argument with a
-- default would leave the seven-argument version callable, granted to `anon`,
-- and quietly free of any of this.
drop function if exists book_table(date, time, int, text, text, text, text, text);

create or replace function book_table(
  on_date   date,
  at_time   time,
  party     int,
  in_name   text,
  in_email  text,
  in_phone  text default null,
  in_note   text default null,
  in_lang   text default 'en',
  -- Hashed by the caller, never an address. Null when the route has no secret
  -- configured, in which case the address key below is the only rail left.
  in_client text default null
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
  keys       text[];
  seen       int;
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

  -- Mirrors the constraints above. Checked here so an over-long field is caught
  -- before the advisory lock and the table search, rather than as a constraint
  -- violation at the very end.
  if char_length(btrim(in_name)) > 80 or char_length(btrim(in_email)) > 254
     or char_length(coalesce(btrim(in_phone), '')) > 32
     or char_length(coalesce(btrim(in_note), '')) > 500 then
    raise exception 'field too long';
  end if;

  -- A closed day, or a closed stretch of one.
  if exists (
    select 1 from blackouts bl
    where bl.date = on_date
      and (bl."from" is null or (at_time >= bl."from" and at_time < bl."to"))
  ) then
    raise exception 'closed at that time';
  end if;

  -- ── the rail ──────────────────────────────────────────────────────────────
  --
  -- Old rows are cleared on the way in, so the table stays the size of the last
  -- hour's traffic and there is nothing to schedule. For a bar taking a few
  -- dozen bookings a day that is a handful of rows.
  delete from booking_throttle where at < now() - throttle_window();

  -- Concatenating anything onto null gives null in Postgres, so a missing
  -- client key removes itself: `nullif` flattens an empty string to null, the
  -- `||` propagates it, and `array_remove` drops the element.
  keys := array_remove(
    array[
      'email:' || lower(btrim(in_email)),
      'ip:' || nullif(btrim(coalesce(in_client, '')), '')
    ]::text[],
    -- Cast, because a bare null leaves the polymorphic argument untyped and
    -- Postgres refuses to guess.
    null::text
  );

  select count(*) into seen
  from booking_throttle t
  where t.key = any (keys);

  if seen >= throttle_max() then
    -- A custom SQLSTATE rather than a message the route would have to match on
    -- by text. It is what turns this into a 429 with something a guest can act
    -- on, instead of a generic failure.
    raise exception 'too many bookings from this source'
      using errcode = 'TN001';
  end if;

  -- Serialises every booking attempt for this date. Held until the transaction
  -- ends, which is the insert below.
  --
  -- Note it is taken after the count, not before: two requests for different
  -- dates do not serialise against each other, so a burst can in principle slip
  -- one extra past the limit. Six or seven is a distinction without a
  -- difference, and holding a lock across the count would serialise every
  -- booking in the building to make it.
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

  -- Recorded in the same transaction as the insert, so a booking that rolls
  -- back for any reason does not count against the guest.
  insert into booking_throttle (key)
  select unnest(keys);

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

revoke execute on function book_table(date, time, int, text, text, text, text, text, text) from public;
grant  execute on function book_table(date, time, int, text, text, text, text, text, text) to anon, authenticated;
