-- Ta-nnin - the whole database, in one paste.
--
-- GENERATED FILE. Do not edit: run `node scripts/bundle-setup.mjs` instead.
-- The real source is supabase/migrations/, and this is those files joined in
-- order with the seed on the end.
--
-- Paste the lot into the Supabase SQL editor and press run. It is safe to run
-- again - every statement in here either creates something only if it is
-- missing or replaces what is there - so if you lose track of what you have
-- already done, running it once more is the right move rather than a risk.
--
-- The one thing it will overwrite: the seed at the bottom clears the menu, the
-- wine list and the bar list and re-inserts them from the repo. Anything Tawat
-- has changed in the admin since the last deploy goes with it. Everything else
-- - bookings, staff logins, the table plan, blackouts - is untouched.
--
-- Built from:
--   0001_init.sql
--   0002_drinks.sql
--   0003_roles.sql
--   0004_booking_locale.sql
--   0005_manage_token.sql
--   0006_tables_and_autoconfirm.sql
--   0007_booking_settings.sql
--   0008_real_table_plan.sql
--   0009_booking_throttle.sql
--   0010_bar_stools.sql
--   0011_two_areas.sql
--   0012_permissions.sql
--   0013_staff_active.sql
--   0014_booking_reminders.sql
--   0015_bar_area.sql
--   0016_area_closures.sql
--   0017_floor_plan_english.sql
--   0018_staff_bookings.sql
--   0019_bookings_realtime.sql
--   0020_floor_plan_geometry.sql
--   0021_day_overrides.sql
--   0022_booking_seats.sql
--   0023_delete_table_cascade.sql
--   0024_fix_bar_area.sql
--   0025_booking_cancelled_by.sql
--   0026_booking_ref_codes.sql
--   0027_shared_and_joined_tables.sql
--   0028_combo_can_use_empty_shared_table.sql
--   0029_reschedule_booking.sql
--   0030_service_windows.sql
--   0031_allocator_refactor_and_pacing.sql
--   0032_multi_table_combos.sql
--   0033_day_notes.sql
--   0034_booking_change_history.sql
--   0035_booking_changes_realtime.sql
--   0036_assign_booking_seats.sql
--   0037_tighten_tables_rls.sql
--   0038_hours_exceptions.sql
--   0039_events_and_marketing.sql
--   0040_menu_price_mid.sql
--   0041_wine_tasting_note.sql
--   0042_event_source.sql
--   0043_media_bucket.sql
--   0044_social_posts.sql
--   0045_instagram_sync.sql
--   0046_dedash_content.sql
--   0047_fix_wine_encoding.sql
--   0048_public_story_settings.sql
--   0049_ordering.sql
--   0050_order_history.sql
--   0051_order_list_split.sql
--   0052_order_finalise.sql
--   0053_gift_vouchers.sql
--   0054_gift_voucher_cap.sql
--   0055_site_content.sql
--   0056_on_menu.sql
--   seed.sql


-- ╭─ 0001_init.sql ───────────────────────────────────────────────────────────

-- Ta-nnin — initial schema.
-- Bookings, menu, wine and shop. One database, read by the website and by the
-- iOS/Android apps through the same PostgREST endpoint.

create extension if not exists "pgcrypto";

-- ── staff ────────────────────────────────────────────────────────────────────
-- Anyone in this table may use the admin. Rows are keyed to Supabase auth users.

do $$ begin
  create type staff_role as enum ('owner', 'manager', 'floor');
exception when duplicate_object then null;
end $$;

create table if not exists staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  role       staff_role not null default 'floor',
  created_at timestamptz not null default now()
);

create or replace function is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from staff where user_id = auth.uid());
$$;

-- ── menu ─────────────────────────────────────────────────────────────────────

do $$ begin
  create type menu_service as enum ('kitchen', 'afterhours');
exception when duplicate_object then null;
end $$;

create table if not exists menu_sections (
  id       text primary key,
  title    text not null,
  service  menu_service not null,
  position int  not null default 0
);

create table if not exists menu_items (
  id            uuid primary key default gen_random_uuid(),
  section_id    text not null references menu_sections (id) on delete cascade,
  name          text not null,
  note          text,
  price         numeric(6,2) not null,
  -- Set only on ranged prices, e.g. Iberico cold cuts 11/19.
  price_max     numeric(6,2),
  with_crackers boolean not null default false,
  sold_out      boolean not null default false,
  allergens     text[] not null default '{}',
  position      int not null default 0,
  updated_at    timestamptz not null default now(),
  constraint price_range_ordered check (price_max is null or price_max > price)
);

create index if not exists menu_items_section_idx on menu_items (section_id, position);

-- ── wine ─────────────────────────────────────────────────────────────────────

do $$ begin
  create type wine_colour as enum ('sparkling', 'white', 'orange', 'rose', 'red', 'sweet');
exception when duplicate_object then null;
end $$;

create table if not exists wines (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  producer   text not null,
  colour     wine_colour not null,
  country    text not null,
  region     text,
  grapes     text[] not null default '{}',
  vintage    int,
  glass      numeric(6,2),
  bottle     numeric(6,2) not null,
  in_shop    boolean not null default false,
  staff_pick boolean not null default false,
  available  boolean not null default true,
  position   int not null default 0
);

create index if not exists wines_colour_idx  on wines (colour) where available;
create index if not exists wines_country_idx on wines (country) where available;

-- ── bookings ─────────────────────────────────────────────────────────────────

do $$ begin
  create type booking_status as enum ('pending', 'confirmed', 'seated', 'cancelled', 'no_show');
exception when duplicate_object then null;
end $$;

create table if not exists bookings (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  time        time not null,
  party_size  int  not null check (party_size between 1 and 40),
  guest_name  text not null,
  guest_email text not null,
  guest_phone text,
  notes       text,
  status      booking_status not null default 'pending',
  -- Opaque token mailed to the guest so they can cancel without an account.
  manage_token uuid not null default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

create index if not exists bookings_date_idx on bookings (date, time);
create unique index if not exists bookings_manage_token_idx on bookings (manage_token);

-- Days, or parts of days, the room is closed: corporate hire, workshops, holidays.
create table if not exists blackouts (
  id     uuid primary key default gen_random_uuid(),
  date   date not null,
  reason text not null,
  "from" time,
  "to"   time,
  constraint blackout_range_complete check (
    ("from" is null and "to" is null) or ("from" is not null and "to" is not null and "to" > "from")
  )
);

create index if not exists blackouts_date_idx on blackouts (date);

-- ── shop ─────────────────────────────────────────────────────────────────────

create table if not exists products (
  id         uuid primary key default gen_random_uuid(),
  wine_id    uuid references wines (id) on delete set null,
  title      text not null,
  price      numeric(6,2) not null,
  stock      int not null default 0 check (stock >= 0),
  reorder_at int not null default 6,
  supplier   text,
  active     boolean not null default true
);

-- What to reorder, and from whom. Drives the supplier email in the admin.
create or replace view low_stock as
  select p.id, p.title, p.stock, p.reorder_at, p.supplier
  from products p
  where p.active and p.stock <= p.reorder_at;

-- ── row level security ───────────────────────────────────────────────────────
-- The public site reads the menu, the wine list and the shop with the anon key.
-- It may create a booking but may never read one back: the guest list is staff
-- only, otherwise the anon key would expose every name, email and phone number.

alter table staff         enable row level security;
alter table menu_sections enable row level security;
alter table menu_items    enable row level security;
alter table wines         enable row level security;
alter table bookings      enable row level security;
alter table blackouts     enable row level security;
alter table products      enable row level security;

drop policy if exists "menu sections are public" on menu_sections;
create policy "menu sections are public" on menu_sections for select using (true);
drop policy if exists "menu items are public" on menu_items;
create policy "menu items are public" on menu_items    for select using (true);
drop policy if exists "wines are public" on wines;
create policy "wines are public" on wines         for select using (available);
drop policy if exists "products are public" on products;
create policy "products are public" on products      for select using (active);
-- Dates only. The reason ("Fred's wedding") is not the public's business, so the
-- site reads this through the public_blackouts view below.
drop policy if exists "blackouts are public" on blackouts;
create policy "blackouts are public" on blackouts     for select using (true);

drop policy if exists "anyone may request a table" on bookings;
create policy "anyone may request a table" on bookings for insert with check (
  date >= current_date
  and date <= current_date + interval '365 days'
  and party_size between 1 and 8
);

drop policy if exists "staff read bookings" on bookings;
create policy "staff read bookings" on bookings for select using (is_staff());
drop policy if exists "staff update bookings" on bookings;
create policy "staff update bookings" on bookings for update using (is_staff());
drop policy if exists "staff delete bookings" on bookings;
create policy "staff delete bookings" on bookings for delete using (is_staff());

drop policy if exists "staff write menu sections" on menu_sections;
create policy "staff write menu sections" on menu_sections for all using (is_staff()) with check (is_staff());
drop policy if exists "staff write menu items" on menu_items;
create policy "staff write menu items" on menu_items    for all using (is_staff()) with check (is_staff());
drop policy if exists "staff write wines" on wines;
create policy "staff write wines" on wines         for all using (is_staff()) with check (is_staff());
drop policy if exists "staff write blackouts" on blackouts;
create policy "staff write blackouts" on blackouts     for all using (is_staff()) with check (is_staff());
drop policy if exists "staff write products" on products;
create policy "staff write products" on products      for all using (is_staff()) with check (is_staff());

drop policy if exists "staff read staff" on staff;
create policy "staff read staff" on staff for select using (is_staff());

-- Public calendar feed: which days are shut, without leaking why.
create or replace view public_blackouts
with (security_invoker = true)
as select date, "from", "to" from blackouts;

-- ╭─ 0002_drinks.sql ─────────────────────────────────────────────────────────

-- The bar list.
--
-- 0001 modelled the food menu and the cellar, but not the thing the QR code on
-- the table actually opens: beers, cocktails, the sober and skinny lists, gin,
-- digestives, spirits, soft drinks, and the wines that are open by the glass.
-- Without this table there is nothing for Tawat to edit, and the hosted menu
-- subscription cannot be cancelled.
--
-- Wines by the glass live here rather than in `wines`. The two lists are
-- genuinely different products — only about half the pours exist as bottles —
-- and the bar thinks of them as one list, so the admin should too.

do $$ begin
  create type drink_category as enum (
  'sparkling', 'rose', 'orange', 'white', 'chilled-red', 'red',
  'beer', 'sober', 'cocktails', 'skinny', 'gin', 'digestives', 'spirits', 'soft'
);
exception when duplicate_object then null;
end $$;

create table if not exists drink_sections (
  id       drink_category primary key,
  title    text not null,
  -- Wine sections render together, above the rest of the bar.
  is_wine  boolean not null default false,
  position int not null default 0
);

create table if not exists drinks (
  id         uuid primary key default gen_random_uuid(),
  section_id drink_category not null references drink_sections (id) on delete cascade,
  name       text not null,
  -- Region, producer detail, or what is in the glass.
  note       text,
  price      numeric(6,2) not null check (price >= 0),
  sold_out   boolean not null default false,
  position   int not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists drinks_section_idx on drinks (section_id, position);

-- Keep updated_at honest so the menu can show when the list last moved.
create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists drinks_touch_updated_at on drinks;
create trigger drinks_touch_updated_at
  before update on drinks
  for each row execute function touch_updated_at();

-- The same trigger is worth having on the food menu.
drop trigger if exists menu_items_touch_updated_at on menu_items;
create trigger menu_items_touch_updated_at
  before update on menu_items
  for each row execute function touch_updated_at();

-- ── row level security ───────────────────────────────────────────────────────
-- Guests read the list; only staff change it.

alter table drink_sections enable row level security;
alter table drinks         enable row level security;

drop policy if exists "drink sections are public" on drink_sections;
create policy "drink sections are public" on drink_sections for select using (true);
drop policy if exists "drinks are public" on drinks;
create policy "drinks are public" on drinks         for select using (true);

drop policy if exists "staff write drink sections" on drink_sections;
create policy "staff write drink sections" on drink_sections for all
  using (is_staff()) with check (is_staff());
drop policy if exists "staff write drinks" on drinks;
create policy "staff write drinks" on drinks for all
  using (is_staff()) with check (is_staff());

-- ╭─ 0003_roles.sql ──────────────────────────────────────────────────────────

-- Role-based permissions.
--
-- 0001 gave every staff member identical power: is_staff() guarded every write.
-- That is wrong for a room with a floor team — someone covering a shift should
-- be able to mark a bottle sold out without also being able to delete the wine
-- list or add themselves a colleague.
--
-- Three roles, and the split follows what people actually do:
--
--   floor   — mark things sold out, and put them back. Nothing else.
--   manager — everything about the menus, the wine and the bookings.
--   owner   — the above, plus adding and removing staff.
--
-- All of it is enforced here rather than in the admin UI. A hidden button is
-- not a permission; this is.

/*
 * Skipped once 0012 has run.
 *
 * setup.sql re-applies every migration in order, and 0012 removes `role` and
 * these three functions for good. A plain `create or replace ... language sql`
 * checks its own body at creation time, so on a second paste this would fail
 * on a column that no longer exists — taking the whole file down with it. The
 * guard makes the historical step a no-op instead, which is what it is.
 */
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'role'
  ) then
    execute $roles$
      create or replace function staff_role_of(uid uuid default auth.uid())
      returns staff_role
      language sql
      security definer
      set search_path = public
      stable
      as $fn$
        select role from staff where user_id = uid;
      $fn$;

      create or replace function is_manager()
      returns boolean
      language sql
      security definer
      set search_path = public
      stable
      as $fn$
        select coalesce(staff_role_of() in ('owner', 'manager'), false);
      $fn$;

      create or replace function is_owner()
      returns boolean
      language sql
      security definer
      set search_path = public
      stable
      as $fn$
        select coalesce(staff_role_of() = 'owner', false);
      $fn$;
    $roles$;
  end if;
end $$;

/*
 * Also skipped once 0012 has run: every policy below names is_manager() or
 * is_owner(), which 0012 drops along with the column they read. 0012 creates
 * the permission-based replacements for all of them, so on a re-paste there
 * is nothing here worth doing and a great deal worth not failing on.
 */
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'role'
  ) then
    execute $roles$
      -- ── replace the blanket staff policies with role-aware ones ──────────────────
      
      drop policy if exists "staff write drinks"         on drinks;
      drop policy if exists "staff write drink sections" on drink_sections;
      drop policy if exists "staff write menu items"     on menu_items;
      drop policy if exists "staff write menu sections"  on menu_sections;
      drop policy if exists "staff write wines"          on wines;
      drop policy if exists "staff write blackouts"      on blackouts;
      drop policy if exists "staff write products"       on products;
      
      -- Anyone on the staff may edit an existing row: this is what makes the
      -- sold-out toggle work for the floor team mid-service.
      drop policy if exists "staff update drinks" on drinks;
      create policy "staff update drinks" on drinks     for update using (is_staff()) with check (is_staff());
      drop policy if exists "staff update menu items" on menu_items;
      create policy "staff update menu items" on menu_items for update using (is_staff()) with check (is_staff());
      
      -- Adding and removing things from the list is a manager's job.
      drop policy if exists "managers insert drinks" on drinks;
      create policy "managers insert drinks" on drinks for insert with check (is_manager());
      drop policy if exists "managers delete drinks" on drinks;
      create policy "managers delete drinks" on drinks for delete using (is_manager());
      
      drop policy if exists "managers insert menu items" on menu_items;
      create policy "managers insert menu items" on menu_items for insert with check (is_manager());
      drop policy if exists "managers delete menu items" on menu_items;
      create policy "managers delete menu items" on menu_items for delete using (is_manager());
      
      drop policy if exists "managers write drink sections" on drink_sections;
      create policy "managers write drink sections" on drink_sections for all
        using (is_manager()) with check (is_manager());
      drop policy if exists "managers write menu sections" on menu_sections;
      create policy "managers write menu sections" on menu_sections for all
        using (is_manager()) with check (is_manager());
      drop policy if exists "managers write wines" on wines;
      create policy "managers write wines" on wines for all
        using (is_manager()) with check (is_manager());
      drop policy if exists "managers write blackouts" on blackouts;
      create policy "managers write blackouts" on blackouts for all
        using (is_manager()) with check (is_manager());
      drop policy if exists "managers write products" on products;
      create policy "managers write products" on products for all
        using (is_manager()) with check (is_manager());
      
      -- Bookings: the floor needs to seat and cancel, so update stays open to staff,
      -- but clearing the record is a manager's call.
      drop policy if exists "staff delete bookings" on bookings;
      drop policy if exists "managers delete bookings" on bookings;
      create policy "managers delete bookings" on bookings for delete using (is_manager());
      
      -- ── the staff list itself ────────────────────────────────────────────────────
      -- Only owners. Without this, any staff member could promote themselves, which
      -- makes every rule above decorative.
      
      drop policy if exists "owners insert staff" on staff;
      create policy "owners insert staff" on staff for insert with check (is_owner());
      drop policy if exists "owners update staff" on staff;
      create policy "owners update staff" on staff for update using (is_owner()) with check (is_owner());
      drop policy if exists "owners delete staff" on staff;
      create policy "owners delete staff" on staff for delete using (is_owner());
      
      -- An owner cannot demote or delete themselves and leave the room without one.
      create or replace function guard_last_owner()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      declare
        remaining int;
      begin
        if (tg_op = 'DELETE' and old.role = 'owner')
           or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
          select count(*) into remaining from staff where role = 'owner' and user_id <> old.user_id;
          if remaining = 0 then
            raise exception 'There has to be at least one owner.';
          end if;
        end if;
        return coalesce(new, old);
      end;
      $fn$;
      
      drop trigger if exists staff_guard_last_owner on staff;
      create trigger staff_guard_last_owner
        before update or delete on staff
        for each row execute function guard_last_owner();
      
    $roles$;
  end if;
end $$;

-- ╭─ 0004_booking_locale.sql ─────────────────────────────────────────────────

-- Which language the guest booked in.
--
-- Without this, the confirmation a Flemish guest gets when staff press
-- "Confirm" three hours later would be in English, because by then the only
-- thing left of their visit is a database row. The website knows the language
-- at the moment of booking; this is where it puts it.
--
-- Defaults to 'en' so every row written before this migration stays valid.

alter table bookings
  add column if not exists locale text not null default 'en'
  check (locale in ('en', 'nl'));

-- The public insert policy has to allow the new column through. Dropping and
-- recreating is the only way to amend a `with check` clause.
drop policy if exists "anyone may request a table" on bookings;

drop policy if exists "anyone may request a table" on bookings;
create policy "anyone may request a table" on bookings for insert with check (
  date >= current_date
  and date <= current_date + interval '365 days'
  and party_size between 1 and 8
  and locale in ('en', 'nl')
);

-- ╭─ 0005_manage_token.sql ───────────────────────────────────────────────────

-- Guest self-service, without an account.
--
-- Every booking already carries a `manage_token` for this. The problem it poses
-- is that row-level security has nothing to match on: the guest is anonymous,
-- so there is no `auth.uid()` to compare against, and a policy broad enough to
-- let them read their own row would let them read everyone's.
--
-- Two security-definer functions instead. They run as the owner, so they see
-- past RLS, but each one only ever touches the single row whose token was
-- passed in, and neither returns the token, the email or the phone number. The
-- token is a v4 uuid — 122 bits of entropy — so guessing one is not a thing
-- that happens.

-- What the manage page shows. Deliberately not `select *`: the guest already
-- knows their own email and there is no reason for this to hand it back, which
-- would turn a leaked link into a way to read contact details.
create or replace function booking_by_token(token uuid)
returns table (
  date       date,
  "time"     time,
  party_size int,
  guest_name text,
  status     booking_status,
  locale     text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.date, b.time, b.party_size, b.guest_name, b.status, b.locale
  from bookings b
  where b.manage_token = token;
$$;

-- Cancelling. Returns the status the booking ended up in, so the caller can
-- tell "you have cancelled it" from "it was already cancelled" from "no such
-- booking" without a second round trip.
create or replace function cancel_booking_by_token(token uuid)
returns booking_status
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  present booking_status;
  when_   date;
begin
  select status, date into present, when_
  from bookings
  where manage_token = token;

  -- No such token. Null rather than an error: the caller should not be able to
  -- tell a wrong token from a deleted booking.
  if present is null then
    return null;
  end if;

  -- Already resolved one way or another. Cancelling something the guest was
  -- seated at would rewrite history.
  if present in ('cancelled', 'seated', 'no_show') then
    return present;
  end if;

  -- Nothing to free up in the past, and letting it through would let someone
  -- with an old link quietly edit last month's covers.
  if when_ < current_date then
    return present;
  end if;

  update bookings set status = 'cancelled' where manage_token = token;
  return 'cancelled';
end;
$$;

-- Postgres grants execute to PUBLIC by default. Take that back and be explicit
-- about who may call these.
revoke execute on function booking_by_token(uuid) from public;
revoke execute on function cancel_booking_by_token(uuid) from public;

grant execute on function booking_by_token(uuid) to anon, authenticated;
grant execute on function cancel_booking_by_token(uuid) to anon, authenticated;

-- ╭─ 0006_tables_and_autoconfirm.sql ─────────────────────────────────────────

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

-- ╭─ 0007_booking_settings.sql ───────────────────────────────────────────────

-- How long a table is held for.
--
-- This was a constant in two places: `TABLE_TURN_MINUTES` in packages/core and
-- `table_turn()` in 0006. Only the SQL one was ever read, and a number that
-- exists twice is a number that will eventually disagree with itself.
--
-- It is also the one setting here that is a judgement rather than a fact. 105
-- minutes is a guess; the real answer depends on whether a table of two on a
-- Tuesday behaves like a table of six on a Saturday, and that is Tawat's call
-- to make and change. So it lives in a row, editable from the admin, rather
-- than in a file that needs a deploy.

create table if not exists booking_settings (
  -- One row, enforced by the primary key: `true` can only be there once.
  id           boolean primary key default true check (id),
  turn_minutes int not null default 105 check (turn_minutes between 30 and 300)
);

insert into booking_settings (id) values (true) on conflict (id) do nothing;

alter table booking_settings enable row level security;

drop policy if exists "settings are public" on booking_settings;
create policy "settings are public" on booking_settings for select using (true);
drop policy if exists "staff write settings" on booking_settings;
create policy "staff write settings" on booking_settings for all using (is_staff()) with check (is_staff());

-- Was immutable when it returned a literal; reading a table makes it stable.
create or replace function table_turn() returns interval
language sql
stable
set search_path = public
as $$ select make_interval(mins => turn_minutes) from booking_settings limit 1 $$;

-- ╭─ 0008_real_table_plan.sql ────────────────────────────────────────────────

-- The actual room, as far as anybody has written it down.
--
-- Replaces the ten invented tables 0006 seeded. Provisional until somebody
-- walks the floor with a tape measure, but it is the real shape of the place
-- rather than a guess that added up to a round number.
--
--   Terrace   3 × 6, 6 × 4, 5 × 2                     52
--   Inside    1 × 16 long, 3 × 4, 3 × 2 wall          34
--   Bar       high table across the bar, 4             4
--   Bar       stools                                   5
--                                                     ---
--                                                      95
--
-- Which is a long way from the 40 the old capacity constant assumed. That
-- constant only ever guarded a check the client could not run anyway; the real
-- limit is now per-table and lives in `book_table`.

-- Clear out 0006's placeholders, but only the ones nobody has been seated at.
-- A table with bookings against it is real data, whatever it is called.
delete from dining_tables t
where t.name in ('T1','T2','T3','T4','T5','T6','T7','T8','H1','H2')
  and not exists (select 1 from bookings b where b.table_id = t.id);

insert into dining_tables (name, seats, min_seats, area, active, position)
select * from (values
  -- ── terrace ──────────────────────────────────────────────────────────────
  -- Fourteen tables and more than half the covers. All of it is weather, which
  -- is why the admin can shut the whole area with one switch.
  ('Terras 6a', 6, 4, 'terrace', true, 10),
  ('Terras 6b', 6, 4, 'terrace', true, 11),
  ('Terras 6c', 6, 4, 'terrace', true, 12),
  ('Terras 4a', 4, 2, 'terrace', true, 13),
  ('Terras 4b', 4, 2, 'terrace', true, 14),
  ('Terras 4c', 4, 2, 'terrace', true, 15),
  ('Terras 4d', 4, 2, 'terrace', true, 16),
  ('Terras 4e', 4, 2, 'terrace', true, 17),
  ('Terras 4f', 4, 2, 'terrace', true, 18),
  ('Terras 2a', 2, 1, 'terrace', true, 19),
  ('Terras 2b', 2, 1, 'terrace', true, 20),
  ('Terras 2c', 2, 1, 'terrace', true, 21),
  ('Terras 2d', 2, 1, 'terrace', true, 22),
  ('Terras 2e', 2, 1, 'terrace', true, 23),

  -- ── inside ───────────────────────────────────────────────────────────────
  -- The long table seats sixteen and takes a minimum of ten, which puts it out
  -- of the website's reach entirely: online bookings stop at eight. That is
  -- deliberate. It is the communal table, for walk-ins and for events somebody
  -- arranges by talking to a person, and handing it to a couple booking at
  -- 19:30 would be the worst use of the best furniture in the room.
  ('Lange tafel', 16, 10, 'inside', true, 30),
  ('Binnen 4a',    4,  2, 'inside', true, 31),
  ('Binnen 4b',    4,  2, 'inside', true, 32),
  ('Binnen 4c',    4,  2, 'inside', true, 33),
  ('Wand 2a',      2,  1, 'inside', true, 34),
  ('Wand 2b',      2,  1, 'inside', true, 35),
  ('Wand 2c',      2,  1, 'inside', true, 36),

  -- ── the bar ──────────────────────────────────────────────────────────────
  -- The high table across from the bar is a table and books like one.
  ('Hoge tafel', 4, 2, 'inside', true, 40),

  -- The stools are not. The allocator gives a party exactly one table, so it
  -- cannot spread four people across four stools — and bar seats are walk-in
  -- anyway, which is most of the point of a wine bar. Inactive keeps them in
  -- the plan, and out of the website's hands.
  ('Bar', 5, 1, 'inside', false, 41)
) as seed(name, seats, min_seats, area, active, position)
-- Named rather than positional, so re-running this is safe and adding a table
-- by hand in the admin first does not get it duplicated here.
where not exists (select 1 from dining_tables d where d.name = seed.name);

-- ╭─ 0009_booking_throttle.sql ───────────────────────────────────────────────

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

-- ╭─ 0010_bar_stools.sql ─────────────────────────────────────────────────────

-- The bar stools count.
--
-- 0008 parked them: one row called 'Bar', five seats, inactive. The reasoning
-- was that the allocator hands a party exactly one table and so cannot spread
-- four people across four stools, and that bar seats are walk-in anyway. Sacha
-- has asked for the five back, and they are five real seats in a room of 95, so
-- leaving them out was leaving a twentieth of the place off the books.
--
-- They come back as five separate stools rather than as the one five-seat row
-- they were. That row would have been the wrong shape: `book_table` gives a
-- party one table and holds all of it, so a single person booking 'Bar' at
-- 19:30 would have taken all five seats off the market until half nine. Five
-- one-seat rows cannot do that. Each is booked by itself or by nobody.
--
-- What that means in practice: a party of one can now book a stool, and gets
-- one in preference to a two-top, because the allocator takes the smallest
-- table that fits — so this quietly frees tables as well as adding seats. A
-- pair who want to sit at the bar still walk in, exactly as they do today. If
-- that ever needs to change it is a question about how `book_table` allocates,
-- not about the furniture, and it should be answered there.

-- The five-seat placeholder, gone — but only if nobody was ever seated at it.
-- It was inactive from the day it was written, so this should always be true;
-- checking anyway, because a row with bookings against it is real data whatever
-- it is called.
delete from dining_tables t
where t.name = 'Bar'
  and not exists (select 1 from bookings b where b.table_id = t.id);

insert into dining_tables (name, seats, min_seats, area, active, position)
select * from (values
  ('Barkruk 1', 1, 1, 'inside', true, 50),
  ('Barkruk 2', 1, 1, 'inside', true, 51),
  ('Barkruk 3', 1, 1, 'inside', true, 52),
  ('Barkruk 4', 1, 1, 'inside', true, 53),
  ('Barkruk 5', 1, 1, 'inside', true, 54)
) as seed(name, seats, min_seats, area, active, position)
-- Named rather than positional, so re-running this is safe and a stool somebody
-- has already edited in the admin does not come back as a duplicate.
where not exists (select 1 from dining_tables d where d.name = seed.name);

-- ╭─ 0011_two_areas.sql ──────────────────────────────────────────────────────

-- Two areas: inside and terrace.
--
-- The plan grew four — 'inside', 'high', 'terrace', 'bar' — because each batch
-- of furniture arrived with its own name. But an area is not a description of
-- the furniture, it is the thing the admin opens and closes with one button,
-- and there is exactly one of those: the terrace, because it is outdoors in
-- Belgium. The high table and the five bar stools are indoors and are never
-- shut on their own, so as areas they were three buttons implying decisions
-- nobody makes.
--
-- Nothing about the booking logic changes: `book_table` has never looked at
-- `area`, only at seats, min_seats and active. Every table stays exactly as
-- bookable as it was. This is regrouping, not a change to the floor.

-- The high table and the stools are inside, because they are.
update dining_tables
set area = 'inside'
where area not in ('inside', 'terrace');

/*
 * Enforced in the database rather than only in the admin's dropdown. The
 * dropdown is a suggestion — anything holding the anon key could write
 * area='patio' and quietly create a fifth area that no button controls and
 * nobody would find until the terrace switch missed a table.
 */
alter table dining_tables drop constraint if exists dining_tables_area_check;
alter table dining_tables
  add constraint dining_tables_area_check check (area in ('inside', 'terrace'));

-- Was already 'inside'; restated so the column's default cannot drift out of
-- the constraint above and start rejecting plain inserts.
alter table dining_tables alter column area set default 'inside';

-- ╭─ 0012_permissions.sql ────────────────────────────────────────────────────

-- Permissions, ticked one at a time. No more role names.
--
-- 0003 sold three bundles: floor, manager, owner. Bundles are a guess about
-- which powers travel together, and the guess was wrong the first time somebody
-- needed to let a person fix the wine list without also handing them the
-- bookings. Sacha has asked for the powers themselves, as checkboxes.
--
-- Six of them, and each one is a real thing the admin does:
--
--   sold_out  mark a bottle or a dish gone, and put it back
--   menu      add and remove food, and the sections it sits in
--   drinks    add and remove wines and the bar list
--   bookings  see the diary, seat people, cancel
--   tables    the floor plan, the terrace switch, how long a table is held
--   people    add and remove staff, set passwords, tick these boxes
--
-- Still enforced here rather than in the admin. Every rule below is a policy in
-- Postgres, so a hidden button is not what stops anybody — the database is.
--
-- Roles are gone completely at the end of this file: the column, the type and
-- the three functions that read it.

/*
 * The list lives in one place. A permission that is not in it cannot be
 * written, so a typo in the admin ('bookins') fails loudly at the database
 * rather than becoming a power nobody holds and no screen grants.
 */
alter table staff add column if not exists permissions text[] not null default '{}';

alter table staff drop constraint if exists staff_permissions_check;
alter table staff add constraint staff_permissions_check check (
  permissions <@ array['sold_out', 'menu', 'drinks', 'bookings', 'tables', 'people']::text[]
);

/*
 * Carry the old roles across, once. Guarded on the column still existing
 * because setup.sql re-runs every migration in order and the drop at the foot
 * of this file has already happened by the second pass — without this, a
 * re-paste would fail on a column that is no longer there.
 *
 * floor keeps bookings: 0001 let anybody on the staff list read and update the
 * diary, and quietly taking that away during a rename would be a change
 * nobody asked for.
 */
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'role'
  ) then
    execute $mig$
      update staff set permissions =
        case role::text
          when 'owner'   then array['sold_out','menu','drinks','bookings','tables','people']
          when 'manager' then array['sold_out','menu','drinks','bookings','tables']
          else                array['sold_out','bookings']
        end
      where permissions = '{}';
    $mig$;
  end if;
end $$;

/** Does the signed-in person hold this permission? */
create or replace function has_perm(p text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p = any(permissions) from staff where user_id = auth.uid()),
    false
  );
$$;

-- ── the policies, one permission at a time ───────────────────────────────────

-- Sold-out is an update on an existing row, and nothing else.
drop policy if exists "staff update drinks" on drinks;
drop policy if exists "sold_out updates drinks" on drinks;
create policy "sold_out updates drinks" on drinks for update
  using (has_perm('sold_out') or has_perm('drinks'))
  with check (has_perm('sold_out') or has_perm('drinks'));

drop policy if exists "staff update menu items" on menu_items;
drop policy if exists "sold_out updates menu items" on menu_items;
create policy "sold_out updates menu items" on menu_items for update
  using (has_perm('sold_out') or has_perm('menu'))
  with check (has_perm('sold_out') or has_perm('menu'));

-- Drinks: the bar list and the wines.
drop policy if exists "managers insert drinks" on drinks;
drop policy if exists "managers delete drinks" on drinks;
drop policy if exists "drinks insert" on drinks;
create policy "drinks insert" on drinks for insert with check (has_perm('drinks'));
drop policy if exists "drinks delete" on drinks;
create policy "drinks delete" on drinks for delete using (has_perm('drinks'));

drop policy if exists "managers write drink sections" on drink_sections;
drop policy if exists "drinks write sections" on drink_sections;
create policy "drinks write sections" on drink_sections for all
  using (has_perm('drinks')) with check (has_perm('drinks'));

drop policy if exists "managers write wines" on wines;
drop policy if exists "drinks write wines" on wines;
create policy "drinks write wines" on wines for all
  using (has_perm('drinks')) with check (has_perm('drinks'));

-- Menu: the food.
drop policy if exists "managers insert menu items" on menu_items;
drop policy if exists "managers delete menu items" on menu_items;
drop policy if exists "menu insert" on menu_items;
create policy "menu insert" on menu_items for insert with check (has_perm('menu'));
drop policy if exists "menu delete" on menu_items;
create policy "menu delete" on menu_items for delete using (has_perm('menu'));

drop policy if exists "managers write menu sections" on menu_sections;
drop policy if exists "menu write sections" on menu_sections;
create policy "menu write sections" on menu_sections for all
  using (has_perm('menu')) with check (has_perm('menu'));

-- Stock lives with the drinks list; it is the same job.
drop policy if exists "managers write products" on products;
drop policy if exists "drinks write products" on products;
create policy "drinks write products" on products for all
  using (has_perm('drinks')) with check (has_perm('drinks'));

-- Bookings: the diary.
drop policy if exists "staff read bookings" on bookings;
drop policy if exists "staff update bookings" on bookings;
drop policy if exists "staff delete bookings" on bookings;
drop policy if exists "managers delete bookings" on bookings;
drop policy if exists "bookings read" on bookings;
create policy "bookings read" on bookings for select using (has_perm('bookings'));
drop policy if exists "bookings update" on bookings;
create policy "bookings update" on bookings for update
  using (has_perm('bookings')) with check (has_perm('bookings'));
drop policy if exists "bookings delete" on bookings;
create policy "bookings delete" on bookings for delete using (has_perm('bookings'));

-- Tables: the floor plan, the terrace switch, the turn length, the closures.
drop policy if exists "staff write tables" on dining_tables;
drop policy if exists "tables write" on dining_tables;
create policy "tables write" on dining_tables for all
  using (has_perm('tables')) with check (has_perm('tables'));

drop policy if exists "staff write settings" on booking_settings;
drop policy if exists "tables write settings" on booking_settings;
create policy "tables write settings" on booking_settings for all
  using (has_perm('tables')) with check (has_perm('tables'));

drop policy if exists "managers write blackouts" on blackouts;
drop policy if exists "tables write blackouts" on blackouts;
create policy "tables write blackouts" on blackouts for all
  using (has_perm('tables')) with check (has_perm('tables'));

-- People: the staff list itself. Without this being its own permission,
-- anybody could tick their own boxes and every rule above is decorative.
drop policy if exists "owners insert staff" on staff;
drop policy if exists "owners update staff" on staff;
drop policy if exists "owners delete staff" on staff;
drop policy if exists "people insert staff" on staff;
create policy "people insert staff" on staff for insert with check (has_perm('people'));
drop policy if exists "people update staff" on staff;
create policy "people update staff" on staff for update
  using (has_perm('people')) with check (has_perm('people'));
drop policy if exists "people delete staff" on staff;
create policy "people delete staff" on staff for delete using (has_perm('people'));

/*
 * The room cannot be left with nobody who can add anybody.
 *
 * Same guard as 0003's last-owner rule, rewritten for the permission: it is
 * now possible to remove 'people' from yourself by unticking a box, which is a
 * quieter way to lock everyone out than deleting an account.
 */
create or replace function guard_last_people()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
begin
  if (tg_op = 'DELETE' and 'people' = any(old.permissions))
     or (tg_op = 'UPDATE' and 'people' = any(old.permissions)
         and not ('people' = any(new.permissions))) then
    select count(*) into remaining
    from staff
    where 'people' = any(permissions) and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'Somebody has to be able to manage people.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists staff_guard_last_owner on staff;
drop trigger if exists staff_guard_last_people on staff;
create trigger staff_guard_last_people
  before update or delete on staff
  for each row execute function guard_last_people();

-- ── roles, gone ──────────────────────────────────────────────────────────────

drop function if exists is_owner();
drop function if exists is_manager();
drop function if exists staff_role_of(uuid);
drop trigger if exists staff_guard_last_owner on staff;
drop function if exists guard_last_owner();

alter table staff drop column if exists role;
drop type if exists staff_role;

-- ╭─ 0013_staff_active.sql ───────────────────────────────────────────────────

-- Turning somebody off without deleting them.
--
-- Removing a person destroys their login and their row. That is right for
-- somebody who has left, and much too much for somebody on holiday, off sick,
-- or a seasonal hand who will be back in April — and the alternative people
-- reach for in that moment is sharing a login, which is worse than either.
--
-- Off means off everywhere, not just hidden on the People page: `is_staff()`
-- and `has_perm()` both stop saying yes, so every policy that names them stops
-- letting the person through. The login still exists and the password still
-- works, so switching them back on is one tap rather than a new account.

alter table staff add column if not exists active boolean not null default true;

/*
 * Rewritten rather than left alone: these two are what every policy in 0003
 * and 0012 actually calls, so changing them here is what makes the switch real
 * instead of cosmetic. Somebody switched off keeps their row and their
 * password and loses every permission until they are switched back on.
 */
create or replace function is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from staff where user_id = auth.uid() and active);
$$;

create or replace function has_perm(p text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p = any(permissions) and active from staff where user_id = auth.uid()),
    false
  );
$$;

/*
 * The last-people guard has to count this too. Switching off the only person
 * who can manage people locks the room out exactly as thoroughly as deleting
 * them, and it is a smaller, easier action to take by accident.
 */
create or replace function guard_last_people()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
begin
  if (tg_op = 'DELETE' and 'people' = any(old.permissions) and old.active)
     or (tg_op = 'UPDATE' and 'people' = any(old.permissions) and old.active
         and not ('people' = any(new.permissions) and new.active)) then
    select count(*) into remaining
    from staff
    where 'people' = any(permissions) and active and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'Somebody has to be able to manage people.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- ╭─ 0014_booking_reminders.sql ──────────────────────────────────────────────

-- Reminder emails: the day before, and the morning of.
--
-- Nothing sent one before now — a request came in, staff confirmed or declined
-- it, and the guest heard nothing else until they either showed up or forgot.
-- Only two more emails, and only for bookings that had time to be forgotten in
-- the first place: one made three hours before the sitting does not need a
-- reminder on top of the confirmation that just landed.
--
-- Two columns rather than one "reminders sent" flag, because the two reminders
-- are independent events that can each fail or succeed on their own — a failed
-- day-before send should not block the same-day one twelve hours later.

alter table bookings add column if not exists reminded_day_before_at timestamptz;
alter table bookings add column if not exists reminded_same_day_at   timestamptz;

-- ╭─ 0015_bar_area.sql ───────────────────────────────────────────────────────

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

-- ╭─ 0016_area_closures.sql ──────────────────────────────────────────────────

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

-- ╭─ 0017_floor_plan_english.sql ─────────────────────────────────────────────

-- The floor plan, in English, pinned to real positions.
--
-- This supersedes every earlier seed of the room — the Dutch names from 0008
-- and the bar-stool split from 0010. The admin is English-only, and the plan
-- itself changed shape once somebody walked the floor: twenty-three tables, the
-- bar counter and its wall as bookable seats, a single high counter along the
-- terrace wall (three stools), and the long communal table down the middle of
-- the room.
--
-- Two rules the old schema carried only in prose now have columns:
--   is_high    — a bar-height table (a "high" chair), as opposed to a low one.
--   is_shared  — its open chairs are offered to other parties of two-plus once
--                it already holds a booking (the long table and the six-tops).
-- And x / y place the table on the plan so the admin can draw it rather than
-- read a list. They are the editor's coordinates, not millimetres of a room.

alter table dining_tables
  add column if not exists x        int,
  add column if not exists y        int,
  add column if not exists is_high  boolean not null default false,
  add column if not exists is_shared boolean not null default false;

-- Clear the old room. Every table seeded before this migration has a null x
-- (the column was only just added), and every table in the new plan below is
-- inserted with an x set — so "x is null" is exactly "belongs to the old plan".
-- An old table nobody was ever seated at is deleted; one with bookings against
-- it is real history, so it is kept but taken out of the plan (made inactive).
delete from dining_tables t
where t.x is null
  and not exists (select 1 from bookings b where b.table_id = t.id);

-- The room, in English. Idempotent by name: re-running this, or adding one of
-- these by hand in the admin first, will not create a duplicate.
insert into dining_tables (name, seats, min_seats, area, active, position, x, y, is_high, is_shared)
select * from (values
  -- ── terrace ──────────────────────────────────────────────────────────────
  ('Terrace — street 6',          6, 2, 'terrace', true,  10, 270, 100, true,  true),
  ('Terrace — street 2a',         2, 2, 'terrace', true,  20, 500, 100, true,  false),
  ('Terrace — street 2b',         2, 2, 'terrace', true,  30, 570, 100, true,  false),
  ('Terrace — street 2c',         2, 2, 'terrace', true,  40, 640, 100, true,  false),
  ('Terrace — front 6',           6, 2, 'terrace', true,  50, 550, 360, true,  true),
  ('Terrace — pavement 2 (high)', 2, 2, 'terrace', true,  60,  40, 460, true,  false),
  ('Terrace — pavement 2 (low)',  2, 2, 'terrace', true,  70, 810, 510, false, false),
  ('Terrace — pavement 2c',       2, 2, 'terrace', true,  80, 260, 530, false, false),
  ('Terrace — pavement 2d',       2, 2, 'terrace', true,  90, 410, 530, false, false),
  ('Terrace — centre 4',          4, 2, 'terrace', true, 100, 290, 330, false, false),
  ('Terrace — side 4',            4, 2, 'terrace', true, 110, 810, 270, false, false),
  ('Terrace — wall counter',      3, 1, 'terrace', true, 120,  40, 200, true,  false),
  -- ── bar ──────────────────────────────────────────────────────────────────
  ('Counter Bar',                 4, 1, 'bar',     true, 130, 260, 770, true,  false),
  ('Counter Wall',                4, 2, 'bar',     true, 140, 260, 970, true,  true),
  ('Window 3',                    2, 2, 'bar',     true, 150, 700, 930, false, false),
  -- ── inside ────────────────────────────────────────────────────────────────
  ('Inside — wall 2a',            2, 2, 'inside',  true, 160, 400, 1100, true,  false),
  ('Inside — wall 2b',            2, 2, 'inside',  true, 170, 570, 1100, true,  false),
  ('Inside — wall 2c',            2, 2, 'inside',  true, 180, 720, 1100, true,  false),
  ('Long table',                 14, 2, 'inside',  true, 190, 250, 1340, true, true),
  ('Inside — back 2a',            2, 2, 'inside',  true, 200, 170, 1130, false, false),
  ('Inside — back 2b',            2, 2, 'inside',  true, 210, 250, 1130, false, false),
  ('Inside — back 2c',            2, 2, 'inside',  true, 220,  70, 1200, false, false),
  ('Inside — back 2d',            2, 2, 'inside',  true, 230,  70, 1270, false, false)
) as seed(name, seats, min_seats, area, active, position, x, y, is_high, is_shared)
where not exists (select 1 from dining_tables d where d.name = seed.name);

-- Anything still carrying a null x is a booked survivor of the old plan: keep
-- the row for its history, but take it out of the website's hands.
update dining_tables set active = false where x is null;

-- ╭─ 0018_staff_bookings.sql ─────────────────────────────────────────────────

-- Staff can take a booking over the phone.
--
-- `book_table` already lets anyone authenticated call it — the public site's
-- anon key and a signed-in staff member hit the exact same function. The one
-- thing standing in the way is email: `guest_email` is `not null`, which is
-- right for a guest filling in a web form and wrong for someone who was only
-- ever asked for a name and a number over the phone.
--
-- The fix is narrow: the column becomes nullable, and the function only
-- insists on an email from callers who are not staff. A phone booking with no
-- address just never gets a confirmation email — the person on the phone
-- already knows the outcome, because they were told it.

alter table bookings alter column guest_email drop not null;

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
  staff_caller boolean := is_staff();
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
  -- A guest booking online has no one to tell them the outcome, so an address
  -- is how they find out. Staff taking a call already are that person.
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

  -- Staff calling this from the admin are not the thing throttling exists to
  -- stop — skip the guest-abuse counter entirely rather than let a busy phone
  -- line trip a limit meant for the anonymous web form.
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

  if not staff_caller then
    insert into booking_throttle (key)
    select unnest(keys);
  end if;

  return query
  insert into bookings (
    date, time, party_size, guest_name, guest_email,
    guest_phone, notes, locale, status, table_id, requested_area
  )
  values (
    on_date, at_time, party, btrim(in_name), nullif(btrim(coalesce(in_email, '')), ''),
    nullif(btrim(coalesce(in_phone, '')), ''),
    nullif(btrim(coalesce(in_note, '')), ''),
    lang, new_status, chosen, wanted_area
  )
  returning bookings.id, bookings.manage_token, bookings.status;
end;
$$;

-- ╭─ 0019_bookings_realtime.sql ──────────────────────────────────────────────

-- Lets staff watch the guest book arrive, live.
--
-- Row-level security already decides who may read a booking (`staff read
-- bookings`, is_staff()) — Realtime enforces that same policy against the
-- subscriber's own JWT, so adding the table to the publication is the only
-- step needed here. Nobody unauthenticated, and no staff member without
-- access to `bookings`, sees anything more than they already could.

do $$ begin
  alter publication supabase_realtime add table bookings;
exception when duplicate_object then null;
end $$;

-- ╭─ 0020_floor_plan_geometry.sql ────────────────────────────────────────────

-- The rendering details behind the floor plan, made real columns.
--
-- 0017 gave every table a position; it did not give it a shape or a seating
-- direction. Those lived only in the floor-map editor built alongside it —
-- fine for a mockup, wrong for the admin's own plan, which needs to draw the
-- exact same room: a rotated six-top, a wall counter that seats people facing
-- the wall, three inside tables shorter on the wall side and seated across
-- from each other. Getting that right took several rounds of correction
-- against the real room; this migration is that same, already-checked layout,
-- not a fresh guess.
--
--   w, h        — footprint in the editor's own units (not millimetres).
--   vertical    — true once a table has been turned 90°: its long sides are
--                 now left/right rather than top/bottom, and split seating
--                 (below) follows.
--   one_row     — every chair on a single edge, backs to the wall — a bench
--                 or a counter, not a table people sit around.
--   flip_row    — for a one_row table, puts the chairs on the opposite edge
--                 (above instead of below, or left instead of right).
--   ends        — seats only at the two short ends, facing across the table
--                 rather than along it.
--   connect_group — tables that push together into one bookable run, e.g. the
--                 four street tables or the two pavement two-tops.

alter table dining_tables
  add column if not exists w             int,
  add column if not exists h             int,
  add column if not exists vertical      boolean not null default false,
  add column if not exists one_row       boolean not null default false,
  add column if not exists flip_row      boolean not null default false,
  add column if not exists ends          boolean not null default false,
  add column if not exists connect_group text;

update dining_tables set w = g.w, h = g.h, vertical = g.vertical, one_row = g.one_row,
  flip_row = g.flip_row, ends = g.ends, connect_group = g.connect_group
from (values
  -- ── terrace ──────────────────────────────────────────────────────────────
  ('Terrace — street 6',          170, 78,  false, false, false, false, 'street'),
  ('Terrace — street 2a',          62, 74,  false, false, false, false, 'street'),
  ('Terrace — street 2b',          62, 74,  false, false, false, false, 'street'),
  ('Terrace — street 2c',          62, 74,  false, false, false, false, 'street'),
  ('Terrace — front 6',            78, 170, true,  false, false, false, null),
  ('Terrace — pavement 2 (high)',  62, 74,  true,  false, false, false, null),
  ('Terrace — pavement 2 (low)',   74, 62,  false, false, false, true,  null),
  ('Terrace — pavement 2c',        74, 62,  false, false, false, true,  'pav'),
  ('Terrace — pavement 2d',        74, 62,  false, false, false, true,  'pav'),
  ('Terrace — centre 4',          120, 80,  false, false, false, false, null),
  ('Terrace — side 4',             76, 120, true,  false, false, false, null),
  ('Terrace — wall counter',       46, 200, false, true,  false, false, null),
  -- ── bar ──────────────────────────────────────────────────────────────────
  ('Counter Bar',                 210, 54,  false, true,  false, false, null),
  ('Counter Wall',                210, 54,  false, true,  true,  false, null),
  ('Window 3',                     74, 62,  false, true,  false, false, null),
  -- ── inside ───────────────────────────────────────────────────────────────
  ('Inside — wall 2a',             62, 74,  true,  false, false, false, null),
  ('Inside — wall 2b',             62, 74,  true,  false, false, false, null),
  ('Inside — wall 2c',             62, 74,  true,  false, false, false, null),
  ('Long table',                  640, 98,  false, false, false, true,  null),
  ('Inside — back 2a',             62, 74,  false, false, false, false, 'back'),
  ('Inside — back 2b',             62, 74,  false, false, false, false, 'back'),
  ('Inside — back 2c',             74, 56,  false, false, false, true,  'back'),
  ('Inside — back 2d',             74, 62,  false, false, false, true,  'back')
) as g(name, w, h, vertical, one_row, flip_row, ends, connect_group)
where dining_tables.name = g.name;

-- ╭─ 0021_day_overrides.sql ──────────────────────────────────────────────────

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

-- ╭─ 0022_booking_seats.sql ──────────────────────────────────────────────────

-- Which specific chairs a booking sits in, not just which table.
--
-- `table_id` alone cannot say "these two seats at Counter Bar, not those
-- two" — the whole-table lock is why a solo guest at the wall counter (or
-- any table) reads as the entire table taken. This does not change that
-- allocation on its own; it only gives staff assigning a party by hand
-- somewhere to record exactly which seats they picked on the floor plan.
-- Null means "the whole table", matching every booking made before this
-- column existed and every one the public site still auto-allocates —
-- `book_table` itself is unchanged.

alter table bookings add column if not exists seat_indices int[];

-- ╭─ 0023_delete_table_cascade.sql ───────────────────────────────────────────

-- Deleting a table, not just deactivating it.
--
-- "Remove" (active = false) already existed and stays reversible — bookings
-- keep pointing at the row, and reactivating puts it back with the same
-- position and floor-plan coordinates untouched, since nothing about that
-- toggle ever wrote to them. This is for the other, permanent action: taking
-- the row out of dining_tables entirely.
--
-- Two foreign keys pointed at it with no ON DELETE behaviour specified,
-- which defaults to NO ACTION — a table with a same-day override on it, or a
-- booking still pointing at it, would refuse to delete with a raw constraint
-- error instead of the confirmation dialog actually doing what it said.
--
--   table_day_overrides.table_id  → cascade. An override for a table that no
--                                   longer exists isn't a real override.
--   bookings.day_override_table_id → set null, the same as bookings.table_id
--                                   already behaves for a deleted real table:
--                                   the booking survives, it just loses that
--                                   specific seat assignment.

alter table table_day_overrides
  drop constraint if exists table_day_overrides_table_id_fkey,
  add constraint table_day_overrides_table_id_fkey
    foreign key (table_id) references dining_tables (id) on delete cascade;

alter table bookings
  drop constraint if exists bookings_day_override_table_id_fkey,
  add constraint bookings_day_override_table_id_fkey
    foreign key (day_override_table_id) references table_day_overrides (id) on delete set null;

-- ╭─ 0024_fix_bar_area.sql ───────────────────────────────────────────────────

-- The bar's three tables must carry area = 'bar', or they don't exist as far
-- as booking the bar is concerned.
--
-- `free_slots` and `book_table` answer "can the bar seat this party?" by
-- filtering `dining_tables` on `area = 'bar'` — a real column value, not the
-- table's name or where it sits on the map. A table drawn in the bar zone but
-- still carrying area = 'inside' is invisible to that query, so the bar reads
-- as full even when every stool is free.
--
-- This slipped through because 0017's English seed inserts these rows only
-- `where not exists (name)`: any Counter Bar / Counter Wall / Window 3 created
-- by hand (or by an earlier draft) before that migration kept its old area,
-- and the seed never corrected it. This is that correction — idempotent, and a
-- no-op once the value is already right.

update dining_tables
set area = 'bar'
where name in ('Counter Bar', 'Counter Wall', 'Window 3')
  and area is distinct from 'bar';

-- ╭─ 0025_booking_cancelled_by.sql ───────────────────────────────────────────

-- Telling a guest's own cancellation apart from a staff one.
--
-- Both are the same thing in the row — `status = 'cancelled'` — and so are
-- indistinguishable in a Realtime payload. But the admin only wants to be
-- *alerted* about the ones it did not do itself: a table freeing up because a
-- guest cancelled online is news worth a toast; a staff member declining a
-- request from the board is not, they are the one who just did it.
--
-- A nullable marker, stamped at the moment of cancellation. The guest's only
-- route, `cancel_booking_by_token`, stamps 'guest'; the staff path
-- (`setBookingStatus`) stamps 'staff' or clears it. The admin's live notifier
-- reacts to 'guest' alone.
--
-- Idempotent: the column add is guarded, the constraint is dropped and
-- recreated, and the function is a create-or-replace.

alter table bookings add column if not exists cancelled_by text;

alter table bookings drop constraint if exists bookings_cancelled_by_check;
alter table bookings
  add constraint bookings_cancelled_by_check
  check (cancelled_by is null or cancelled_by in ('guest', 'staff'));

-- Cancelling, now recording that it was the guest who did it. Otherwise
-- unchanged from 0005: same token-only authorisation, same refusal to reopen a
-- seated or past booking, same three-way return so the caller can tell "you
-- have cancelled it" from "it was already cancelled" from "no such booking".
create or replace function cancel_booking_by_token(token uuid)
returns booking_status
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  present booking_status;
  when_   date;
begin
  select status, date into present, when_
  from bookings
  where manage_token = token;

  -- No such token. Null rather than an error: the caller should not be able to
  -- tell a wrong token from a deleted booking.
  if present is null then
    return null;
  end if;

  -- Already resolved one way or another. Cancelling something the guest was
  -- seated at would rewrite history.
  if present in ('cancelled', 'seated', 'no_show') then
    return present;
  end if;

  -- Nothing to free up in the past, and letting it through would let someone
  -- with an old link quietly edit last month's covers.
  if when_ < current_date then
    return present;
  end if;

  update bookings
  set status = 'cancelled', cancelled_by = 'guest'
  where manage_token = token;
  return 'cancelled';
end;
$$;

-- ╭─ 0026_booking_ref_codes.sql ──────────────────────────────────────────────

-- Reservation and cancellation reference codes.
--
-- Two short, human codes: a reservation number a guest gets when their table is
-- confirmed, and a cancellation number when it is cancelled. Backed by
-- sequences, so each is unique without a lookup and short enough to read down a
-- phone.
--
-- The reservation code is a column default, so every way a booking can arrive —
-- the website, a staff phone booking, a hand-written row — gets one for free.
-- The cancellation code is a trigger, assigned the moment a booking first
-- becomes cancelled, whichever route did it: the guest's own link or the staff
-- board both run an UPDATE, and this catches both without either having to
-- remember to.
--
-- Idempotent: sequences and columns are guarded, the backfill only touches rows
-- with no code yet, and the trigger and functions are drop-and-recreate.

create sequence if not exists booking_ref_seq start 1000;
create sequence if not exists booking_cancel_seq start 1;

alter table bookings
  add column if not exists ref_code text
    default 'TN-' || to_char(nextval('booking_ref_seq'), 'FM00000');
alter table bookings add column if not exists cancel_code text;

-- Any row that predates the column (or was added before the default existed).
update bookings
set ref_code = 'TN-' || to_char(nextval('booking_ref_seq'), 'FM00000')
where ref_code is null;

-- A cancellation code, assigned once, the first time a booking becomes
-- cancelled — not re-minted if it is reinstated and cancelled again, so the
-- number a guest was told stays the number on the row.
create or replace function set_cancel_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'cancelled'
     and old.status is distinct from 'cancelled'
     and new.cancel_code is null then
    new.cancel_code := 'TN-C-' || to_char(nextval('booking_cancel_seq'), 'FM00000');
  end if;
  return new;
end;
$$;

drop trigger if exists booking_cancel_code on bookings;
create trigger booking_cancel_code
  before update on bookings
  for each row execute function set_cancel_code();

-- The reservation code for one manage token.
--
-- For the confirmation email on a website booking that confirmed itself: the
-- anon key cannot read the row back — row-level security forbids listing the
-- guest book — and the code is not a secret, so a narrow security-definer read
-- of just this one column is the safe way to fetch it. Unlike booking_by_token
-- it returns nothing that identifies the guest.
create or replace function booking_ref_by_token(token uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select ref_code from bookings where manage_token = token;
$$;

revoke execute on function booking_ref_by_token(uuid) from public;
grant execute on function booking_ref_by_token(uuid) to anon, authenticated;

-- ╭─ 0027_shared_and_joined_tables.sql ───────────────────────────────────────

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

-- ╭─ 0028_combo_can_use_empty_shared_table.sql ───────────────────────────────

-- A party too big for every exclusive combo can now be offered a shared
-- table too, but only when that table is currently holding nobody at all —
-- using it converts it, for that one turn, from "open to other parties" to
-- "exclusively this party's", same as any other table in a combo.
--
-- Why this is safe: `table_has_room`'s shared branch already answers
-- "would `party` more people fit alongside whoever's here" — asking it
-- with `party = the table's own seat count` can only be true when nobody
-- else is there yet (any existing booking, however small, already leaves
-- less room than the table's full seat count). That is exactly "is this
-- table empty", so the same call now covers both exclusive and shared
-- tables — no separate branch needed.
--
-- Once such a combo is booked, the whole party's size is recorded as usual
-- against both `table_id` and (via `joined_table_id`) the shared table —
-- which, being larger than the shared table's own seats, keeps its
-- shared-capacity check permanently over-full for that slot, so nobody
-- else is ever offered it for this turn. No separate "claimed exclusively"
-- flag needed.
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
    and a.area = b.area
    and (wanted_area is null or a.area = wanted_area)
    and a.seats + b.seats >= party
    and party > least(a.seats, b.seats)
    and party >= greatest(a.min_seats, b.min_seats)
    and not exists (
      select 1 from area_closures ac
      where ac.area = a.area and on_date between ac.from_date and ac.to_date
    )
    and table_has_room(a.id, null, a.seats, a.is_shared, on_date, at_time, a.seats)
    and table_has_room(b.id, null, b.seats, b.is_shared, on_date, at_time, b.seats)
  -- Prefer a pair that leaves every shared table free for other parties,
  -- when an equally-sized all-exclusive pair exists; only reach for a
  -- shared table's full capacity when nothing else fits as well.
  order by (a.seats + b.seats) asc,
           (case when a.is_shared or b.is_shared then 1 else 0 end) asc,
           least(a.position, b.position) asc,
           greatest(a.position, b.position) asc
  limit 1;
$$;

-- ╭─ 0029_reschedule_booking.sql ─────────────────────────────────────────────

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

-- ╭─ 0030_service_windows.sql ────────────────────────────────────────────────

-- Opening hours as data, not code.
--
-- The weekly service windows lived only in a constant in packages/core, so a
-- seasonal change or a one-off holiday schedule meant a code deploy. This is
-- the same seven rows as a table staff can edit, read by everything that needs
-- the hours: the website's date picker, the booking guard, the opening-hours
-- block on the site, and the search-result schema.
--
-- One row per weekday (0 = Sunday … 6 = Saturday, matching JS getUTCDay and
-- the core constant). `closed` takes a whole weekday out without deleting its
-- times, so turning, say, Mondays back on later keeps the hours that were
-- there. Times are stored even for a closed day for exactly that reason.
--
-- Seeded from the constant that was the source of truth until now. Public read
-- like booking_settings — the hours are on the website already — and staff
-- write behind the same gate as the rest of the room.
--
-- Idempotent: guarded create, seed on-conflict-do-nothing, drop/recreate
-- policies.

create table if not exists service_windows (
  weekday      int primary key check (weekday between 0 and 6),
  opens        time not null,
  closes       time not null,
  last_seating time not null,
  closed       boolean not null default false
);

insert into service_windows (weekday, opens, closes, last_seating, closed) values
  (1, '17:00', '00:00', '21:30', false),
  (2, '17:00', '00:00', '21:30', false),
  (3, '17:00', '00:00', '21:30', false),
  (4, '17:00', '00:00', '21:30', false),
  (5, '17:00', '00:30', '21:30', false),
  (6, '14:00', '00:30', '21:30', false),
  (0, '14:00', '23:00', '21:30', false)
on conflict (weekday) do nothing;

alter table service_windows enable row level security;

drop policy if exists "hours are public" on service_windows;
create policy "hours are public" on service_windows for select using (true);

drop policy if exists "staff write hours" on service_windows;
create policy "staff write hours" on service_windows for all using (is_staff()) with check (is_staff());

-- ╭─ 0031_allocator_refactor_and_pacing.sql ──────────────────────────────────

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

-- ╭─ 0032_multi_table_combos.sql ─────────────────────────────────────────────

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

-- ╭─ 0033_day_notes.sql ──────────────────────────────────────────────────────

-- A shared, staff-visible note for one service day — "VIP at 8, chef running
-- late" — separate from any individual booking's own notes. One row per
-- date; staff overwrite it in place rather than appending a log, so it
-- always reads as "today's note", not a history to scroll through.
--
-- `updated_by`/`updated_at` are stamped by a trigger rather than trusted from
-- the client, so the client only ever needs to send `date` and `note`.
--
-- Idempotent: guarded table create, create-or-replace function, guarded
-- trigger drop-then-create.

create table if not exists day_notes (
  date        date primary key,
  note        text not null default '',
  updated_by  uuid references staff (user_id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table day_notes enable row level security;

drop policy if exists "staff read day notes" on day_notes;
create policy "staff read day notes" on day_notes for select using (has_perm('bookings'));

drop policy if exists "staff write day notes" on day_notes;
create policy "staff write day notes" on day_notes for all
  using (has_perm('bookings')) with check (has_perm('bookings'));

create or replace function stamp_day_note()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stamp_day_note on day_notes;
create trigger stamp_day_note
  before insert or update on day_notes
  for each row execute function stamp_day_note();

-- ╭─ 0034_booking_change_history.sql ─────────────────────────────────────────

-- Who changed what on a booking, and when.
--
-- Every mutation path — a staff edit, a seat pick, a reschedule, a guest
-- self-cancel — writes through `bookings` one way or another, so a single
-- `after update` trigger on that table catches all of them without every
-- call site needing to remember to log anything. The alternative (logging
-- from each RPC/route individually) is exactly the kind of thing that
-- silently rots the moment somebody adds a ninth way to touch a booking.
--
-- Only the fields that matter operationally are tracked, not every column —
-- a contact-detail or notes edit is not "the room changed"; table, seats,
-- status, time and party size are.
--
-- `changed_by` reads `auth.uid()` directly, which reflects the calling JWT
-- regardless of the trigger function's own security context — so staff
-- attribution survives even from inside a `security definer` RPC like
-- `book_table` or `reschedule_booking`. A guest path (self-cancel, the public
-- booking form) has no session, so it logs `null` — shown as "guest".
--
-- The trigger function is `security definer` so its insert into
-- booking_changes is not itself blocked by that table's own read-only RLS —
-- same reasoning as `is_staff()`/`has_perm()` already use.
--
-- Idempotent: guarded table/index create, drop-then-create policy, guarded
-- trigger drop-then-create.

create table if not exists booking_changes (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  changed_by uuid references staff (user_id) on delete set null,
  changed_at timestamptz not null default now(),
  changes    jsonb not null
);

create index if not exists booking_changes_booking_id_idx on booking_changes (booking_id, changed_at desc);

alter table booking_changes enable row level security;

drop policy if exists "staff read booking changes" on booking_changes;
create policy "staff read booking changes" on booking_changes for select using (has_perm('bookings'));

create or replace function log_booking_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  diff jsonb := '{}'::jsonb;
begin
  if new.status is distinct from old.status then
    diff := diff || jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', new.status));
  end if;
  if new.table_id is distinct from old.table_id then
    diff := diff || jsonb_build_object('table_id', jsonb_build_object('old', old.table_id, 'new', new.table_id));
  end if;
  if new.joined_table_ids is distinct from old.joined_table_ids then
    diff := diff || jsonb_build_object(
      'joined_table_ids', jsonb_build_object('old', old.joined_table_ids, 'new', new.joined_table_ids)
    );
  end if;
  if new.seat_indices is distinct from old.seat_indices then
    diff := diff || jsonb_build_object(
      'seat_indices', jsonb_build_object('old', old.seat_indices, 'new', new.seat_indices)
    );
  end if;
  if new.date is distinct from old.date or new.time is distinct from old.time then
    diff := diff || jsonb_build_object('when', jsonb_build_object(
      'old', jsonb_build_object('date', old.date, 'time', old.time),
      'new', jsonb_build_object('date', new.date, 'time', new.time)
    ));
  end if;
  if new.party_size is distinct from old.party_size then
    diff := diff || jsonb_build_object('party_size', jsonb_build_object('old', old.party_size, 'new', new.party_size));
  end if;

  if diff <> '{}'::jsonb then
    insert into booking_changes (booking_id, changed_by, changes)
    values (new.id, auth.uid(), diff);
  end if;

  return new;
end;
$$;

drop trigger if exists log_booking_change on bookings;
create trigger log_booking_change
  after update on bookings
  for each row execute function log_booking_change();

-- ╭─ 0035_booking_changes_realtime.sql ───────────────────────────────────────

-- Lets the "new events" badge catch a guest cancellation live, not just on
-- the next page load.
--
-- Same reasoning as 0019 for `bookings`: row-level security already decides
-- who may read `booking_changes` (`staff read booking changes`), Realtime
-- enforces that same policy against the subscriber's own JWT, so adding the
-- table to the publication is the only step needed here.

do $$ begin
  alter publication supabase_realtime add table booking_changes;
exception when duplicate_object then null;
end $$;

-- ╭─ 0036_assign_booking_seats.sql ───────────────────────────────────────────

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

-- ╭─ 0037_tighten_tables_rls.sql ─────────────────────────────────────────────

-- Two small RLS cleanups, no behaviour change for staff.
--
-- 1. `dining_tables` has carried a public `select using (active)` policy
--    since 0006, back when the admin read it with the anon key. Every
--    caller now reads it signed in (`apps/web` never queries it at all —
--    guest availability goes through `free_slots`/`book_table`, both
--    `security definer`), so the anon key can currently list the whole
--    floor plan — names, seat counts, x/y layout — for no reason. Replaced
--    with a staff-only read, same as `area_closures`/`table_day_overrides`
--    already are; any signed-in staff member can still see the floor plan,
--    same as today, just not a stranger with the public key.
--
-- 2. `area_closures` and `table_day_overrides` each carry a `select` policy
--    that is byte-for-byte the same condition as their own `for all` policy
--    — `for all` already grants select, so the extra one is pure dead
--    weight, not a different rule. Dropped.

drop policy if exists "tables are public" on dining_tables;
drop policy if exists "staff read tables" on dining_tables;
create policy "staff read tables" on dining_tables for select using (is_staff());

drop policy if exists "tables read area closures" on area_closures;
drop policy if exists "tables read day overrides" on table_day_overrides;

-- ╭─ 0038_hours_exceptions.sql ───────────────────────────────────────────────

-- One-off opening-hours exceptions, shown on the website.
--
-- Separate from `blackouts` on purpose. Blackouts drive the booking system —
-- they stop the picker offering a closed day — whereas these are only about what
-- the public site's opening-hours block says. Ta-nnin books through Zenchef, so
-- their closures are never a booking rule, just "the door is shut that day" or
-- "we open different hours that day".
--
-- One row per date. Either the room is closed all day (`closed` = true), or it
-- opens for a one-off window (`opens`/`closes`). No `closes > opens` check: a
-- late close is stored as a small time (00:30) exactly like service_windows.
-- `note` is the public caption — "Christmas", "Private event".

create table if not exists hours_exceptions (
  date   date primary key,
  closed boolean not null default false,
  opens  time,
  closes time,
  note   text,
  constraint hours_exception_shape check (
    closed = true or (opens is not null and closes is not null)
  )
);

alter table hours_exceptions enable row level security;

-- Public read: the hours are on the website already, same as service_windows
-- and blackouts.
drop policy if exists "hours exceptions public" on hours_exceptions;
create policy "hours exceptions public" on hours_exceptions for select using (true);

-- Staff write, the same gate as the rest of the room.
drop policy if exists "staff write hours exceptions" on hours_exceptions;
create policy "staff write hours exceptions" on hours_exceptions
  for all using (is_staff()) with check (is_staff());

-- ╭─ 0039_events_and_marketing.sql ───────────────────────────────────────────

-- Events, and the marketing permission that guards them.
--
-- What's-on for the site: café society nights, workshops, things with CE-LLAR.
-- Public reads the published ones; a new `marketing` permission lets the owner
-- (or whoever they hand it to) add, reorder and remove them — separate from the
-- food/wine/bookings powers so a marketing person needs nothing else.

-- 1. Add `marketing` to the permission whitelist and hand it to the owners.
alter table staff drop constraint if exists staff_permissions_check;
alter table staff add constraint staff_permissions_check check (
  permissions <@ array['sold_out', 'menu', 'drinks', 'bookings', 'tables', 'people', 'marketing']::text[]
);

-- Whoever already manages people gets marketing too, once, so the owner can use
-- it immediately without ticking their own box first.
update staff
  set permissions = array_append(permissions, 'marketing')
  where 'people' = any(permissions) and not ('marketing' = any(permissions));

-- 2. The events themselves.
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  kind        text not null default 'other'
                check (kind in ('cafe-society', 'workshop', 'cellar', 'other')),
  starts_on   date,
  ends_on     date,
  location    text,
  summary     text,
  body        text,
  image_url   text,
  position    int not null default 0,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists events_position_idx on events (position);

alter table events enable row level security;

-- Published events are public; staff see drafts too.
drop policy if exists "events public read" on events;
create policy "events public read" on events
  for select using (published = true or is_staff());

-- Only the marketing permission writes.
drop policy if exists "marketing write events" on events;
create policy "marketing write events" on events
  for all using (has_perm('marketing')) with check (has_perm('marketing'));

-- ╭─ 0040_menu_price_mid.sql ─────────────────────────────────────────────────

-- A middle price tier for the food menu.
--
-- The Ibérico cold cuts come in three plate sizes — 11 / 16 / 19 — but the menu
-- only stored two prices (price, price_max). This adds an optional middle tier
-- so a dish can list three. Nullable; almost every dish uses none or one.

alter table menu_items add column if not exists price_mid numeric(6,2);

-- ╭─ 0041_wine_tasting_note.sql ──────────────────────────────────────────────

-- A tasting note for a wine.
--
-- The cellar list carries facts — producer, region, grapes, vintage — but no
-- room to say how a bottle actually tastes. This adds a free-text note the
-- staff can write and the website shows, so a wine can be explained by taste.

alter table wines add column if not exists tasting_note text;

-- ╭─ 0042_event_source.sql ───────────────────────────────────────────────────

-- Instagram provenance for events.
--
-- Events curated from @tannin_antwerp / @cellar_antwerp can link back to the
-- post they came from, and record which account it was so the public card can
-- read "Seen on @…". Both columns are nullable and additive — every existing
-- event is untouched, and an event with no source simply shows no link.

alter table events
  add column if not exists source_url text,
  add column if not exists source_account text
    check (source_account in ('tannin', 'cellar'));

-- ╭─ 0043_media_bucket.sql ───────────────────────────────────────────────────

-- Public bucket for admin-uploaded images.
--
-- The events editor (and later menu/wine) had a plain URL field, so a photo
-- meant hotlinking or a developer dropping a file in the repo and deploying.
-- With this bucket, whoever holds `marketing` picks a file in the browser and
-- the admin writes to Supabase Storage, storing the returned public URL in
-- `events.image_url`.
--
-- Public read; only the marketing permission writes. Menu/wine will reuse the
-- same bucket when their editors get an image field — one bucket keeps the
-- policy surface small.
--
-- PGlite has no `storage` schema, so the migration test skips this whole block.
-- The real Supabase runs it; the tests still verify every prior migration.

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $mig$
      insert into storage.buckets (id, name, public)
      values ('media', 'media', true)
      on conflict (id) do nothing
    $mig$;

    execute $mig$ drop policy if exists "media public read" on storage.objects $mig$;
    execute $mig$
      create policy "media public read" on storage.objects
        for select using (bucket_id = 'media')
    $mig$;

    execute $mig$ drop policy if exists "marketing writes media" on storage.objects $mig$;
    execute $mig$
      create policy "marketing writes media" on storage.objects
        for insert to authenticated
        with check (bucket_id = 'media' and has_perm('marketing'))
    $mig$;

    execute $mig$ drop policy if exists "marketing updates media" on storage.objects $mig$;
    execute $mig$
      create policy "marketing updates media" on storage.objects
        for update to authenticated
        using (bucket_id = 'media' and has_perm('marketing'))
        with check (bucket_id = 'media' and has_perm('marketing'))
    $mig$;

    execute $mig$ drop policy if exists "marketing deletes media" on storage.objects $mig$;
    execute $mig$
      create policy "marketing deletes media" on storage.objects
        for delete to authenticated
        using (bucket_id = 'media' and has_perm('marketing'))
    $mig$;
  end if;
end $$;

-- ╭─ 0044_social_posts.sql ───────────────────────────────────────────────────

-- Social posts — the "From the street" Instagram tiles on the homepage.
--
-- Staff with the marketing permission curate which posts appear: upload the
-- image to the media bucket (0043), paste the Instagram link, set a caption.
-- The public site shows only published posts; staff see drafts in the admin.
-- Order is manually arranged, same as events.

create table if not exists social_posts (
  id         uuid        primary key default gen_random_uuid(),
  image_url  text        not null,
  label      text        not null,
  title      text        not null,
  href       text        not null,
  position   integer     not null default 0,
  published  boolean     not null default true,
  created_at timestamptz not null default now()
);

create index if not exists social_posts_position_idx on social_posts (position);

alter table social_posts enable row level security;

-- Published posts are public; staff see drafts too.
drop policy if exists "social_posts public read" on social_posts;
create policy "social_posts public read" on social_posts
  for select using (published = true or is_staff());

-- Only the marketing permission writes.
drop policy if exists "marketing write social_posts" on social_posts;
create policy "marketing write social_posts" on social_posts
  for all using (has_perm('marketing')) with check (has_perm('marketing'));

-- ╭─ 0045_instagram_sync.sql ─────────────────────────────────────────────────

-- Instagram sync support.
--
-- Adds instagram_id to social_posts so the sync can upsert without duplicates,
-- and app_settings for storing the access token and connection metadata.
-- Posts without an instagram_id are manual uploads — the sync never touches them.

alter table social_posts
  add column if not exists instagram_id text;

create unique index if not exists social_posts_instagram_id_idx
  on social_posts (instagram_id)
  where instagram_id is not null;

-- App-level key/value store: Instagram token, last-sync time, etc.
create table if not exists app_settings (
  key        text        primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

-- Only marketing staff can read or write settings.
drop policy if exists "marketing read write app_settings" on app_settings;
create policy "marketing read write app_settings" on app_settings
  for all using (has_perm('marketing')) with check (has_perm('marketing'));

-- ╭─ 0046_dedash_content.sql ─────────────────────────────────────────────────

-- Replace em dashes (-) with hyphens (-) across website-facing content, so the
-- live menu, wine list, bar list and events read with plain hyphens instead of
-- em dashes. Idempotent and safe to re-run.
--
-- Left untouched on purpose: dining_tables.name (internal floor-plan labels the
-- app and its tests match by exact string) and social_posts (mirrored from
-- Instagram, overwritten on the next sync).

update menu_sections set title = replace(title, '—', '-') where title like '%—%';

update menu_items
  set name = replace(name, '—', '-'),
      note = replace(note, '—', '-')
  where name like '%—%' or note like '%—%';

update drink_sections set title = replace(title, '—', '-') where title like '%—%';

update drinks
  set name = replace(name, '—', '-'),
      note = replace(note, '—', '-')
  where name like '%—%' or note like '%—%';

update wines
  set name = replace(name, '—', '-'),
      producer = replace(producer, '—', '-'),
      country = replace(country, '—', '-'),
      region = replace(region, '—', '-'),
      tasting_note = replace(tasting_note, '—', '-')
  where name like '%—%' or producer like '%—%' or country like '%—%'
     or region like '%—%' or tasting_note like '%—%';

update events
  set title = replace(title, '—', '-'),
      location = replace(location, '—', '-'),
      summary = replace(summary, '—', '-'),
      body = replace(body, '—', '-')
  where title like '%—%' or location like '%—%' or summary like '%—%' or body like '%—%';

-- ╭─ 0047_fix_wine_encoding.sql ──────────────────────────────────────────────

-- Repair cellar rows that were written as UTF-8 and stored as Windows-1252.
--
-- The visible symptom was "Les Longeroies â€” Marsannay" on the wine page. The
-- site now also repairs these on read (`repairEncoding` in @tannin/core, called
-- from `fetchWines`), so this migration is not what makes the page correct - it
-- is what stops the bad bytes being carried forward into exports, the printed
-- wine list and anything else that reads the table directly.
--
-- Only the sequences we have actually seen are touched. A repair table that
-- guesses is how one broken row becomes ten. Idempotent: re-running it on
-- already-correct text changes nothing.

update wines
set
  name = replace(replace(name, 'â€”', '-'), 'â€“', '-'),
  producer = replace(replace(producer, 'â€”', '-'), 'â€“', '-'),
  region = replace(replace(region, 'â€”', '-'), 'â€“', '-'),
  tasting_note = replace(replace(tasting_note, 'â€”', '-'), 'â€“', '-')
where
  name like '%â€%'
  or producer like '%â€%'
  or region like '%â€%'
  or tasting_note like '%â€%';

-- The same bottle also had its region ("Burgundy") sitting in the country
-- column, which is the data problem the wine page's country filter exists to
-- survive. The site resolves this at read time for every row
-- (`resolveWineOrigin`), so this only settles the one row we know by name
-- rather than attempting a bulk re-filing in SQL that the application already
-- does correctly and testably.
update wines
set country = 'France', region = coalesce(nullif(region, ''), 'Burgundy')
where country = 'Burgundy';

-- ╭─ 0048_public_story_settings.sql ──────────────────────────────────────────

-- Let the public site read the current Instagram story.
--
-- The bug: `app_settings` was created in 0045 with exactly one policy,
-- "marketing read write app_settings", gated on `has_perm('marketing')`. The
-- website reads with the anon key, which has no permissions at all, so its
-- select returned zero rows rather than an error - and `fetchCurrentStory` maps
-- "no story_image_url" to "no story". Staff could publish a story, see it saved
-- in admin, and watch nothing appear on the home page, with nothing logged
-- anywhere. The feature had never worked in public.
--
-- The fix is deliberately narrow. `app_settings` is also where 0045 intends to
-- keep the Instagram access token and its connection metadata, so a blanket
-- `using (true)` here would publish a long-lived credential to anyone who
-- guessed the table name. This grants read on the four story keys and nothing
-- else, listed explicitly rather than by a `story_%` prefix: a prefix would
-- silently expose a future key like `story_upload_token`, and being forced to
-- edit this list when the story gains a field is the point, not an oversight.
--
-- The keys are exactly the ones `fetchCurrentStory` asks for. Permissive
-- policies are OR'd, so marketing staff keep full read and write through the
-- existing policy; this only widens select, and only for these rows.

drop policy if exists "app_settings public read story" on app_settings;
create policy "app_settings public read story" on app_settings
  for select using (
    key in ('story_image_url', 'story_href', 'story_account', 'story_expires_at')
  );

-- ╭─ 0049_ordering.sql ───────────────────────────────────────────────────────

-- The buyer's catalogue and shopping list.
--
-- Two tables, because what you buy and what you sell are different lists. A
-- dish uses many products and a product serves many dishes, so deriving the
-- order list from the menus would break the first time somebody buys ice, cling
-- film or coffee filters - none of which are on a menu.
--
--   order_items       the catalogue: everything the bar and kitchen can buy
--   order_list_items  the current shopping list: catalogue row + a quantity
--
-- `verified` is the honest part. Wines and bar stock are seeded from rows the
-- venue already maintains, so they are true by construction. Food ingredients
-- and cocktail components are NOT recorded anywhere in this database - the menu
-- stores a dish name and a garnish note, never a recipe - so they are seeded
-- from standard recipes for those dishes and marked unverified. They are a
-- starting point for the kitchen to correct, not a claim about how Ta-nnin
-- actually cooks, and the admin marks them as such until somebody confirms one.

-- Who you buy it from. A managed list rather than free text on each product:
-- an order is placed per supplier, so "Horeca Totaal" and "horeca totaal"
-- being two different answers would quietly split one order into two.
create table if not exists order_suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  note       text,
  position   integer not null default 0,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table order_suppliers enable row level security;

drop policy if exists "order_suppliers staff" on order_suppliers;
create policy "order_suppliers staff" on order_suppliers
  for all using (has_perm('menu') or has_perm('drinks'))
  with check (has_perm('menu') or has_perm('drinks'));

-- Only three names are known so far, and the rest get added as staff learn
-- them, so this is seeded thin on purpose rather than guessed at.
insert into order_suppliers (name, note, position) values
  ('Horeca Totaal', 'general wholesale', 1),
  ('Van Tricht', 'cheese', 2),
  ('De Laet & Van Haver', 'meat', 3)
on conflict (name) do nothing;

create table if not exists order_items (
  id         uuid primary key default gen_random_uuid(),
  category   text not null check (category in ('wine', 'drink', 'food')),
  name       text not null,
  -- What you order it by: bottle, kg, crate. Without this a list of bare
  -- numbers is ambiguous at the counter.
  unit       text,
  -- Supplier, size, or whatever the buyer needs to see. Free text on purpose.
  note       text,
  position   integer not null default 0,
  verified   boolean not null default false,
  archived   boolean not null default false,
  -- Null until somebody knows. set null on delete, so removing a supplier
  -- unassigns its products rather than deleting things you still buy.
  supplier_id uuid references order_suppliers (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_items_category_idx on order_items (category, position);

create table if not exists order_list_items (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items (id) on delete cascade,
  quantity      numeric not null default 1 check (quantity > 0),
  -- On the list but not on this trip. Unticking is not the same as removing:
  -- the buyer keeps the line and its quantity for next week, and only the
  -- ticked rows reach the printout and the email.
  checked       boolean not null default true,
  added_at      timestamptz not null default now(),
  -- One line per product; adding it twice raises the quantity instead.
  unique (order_item_id)
);

alter table order_items enable row level security;
alter table order_list_items enable row level security;

-- Kitchen staff hold 'menu', bar staff hold 'drinks', and both do the buying.
-- Deliberately not a new permission: adding one would mean re-granting rights
-- to every existing staff member before anybody could open the page.
drop policy if exists "order_items staff" on order_items;
create policy "order_items staff" on order_items
  for all using (has_perm('menu') or has_perm('drinks'))
  with check (has_perm('menu') or has_perm('drinks'));

drop policy if exists "order_list_items staff" on order_list_items;
create policy "order_list_items staff" on order_list_items
  for all using (has_perm('menu') or has_perm('drinks'))
  with check (has_perm('menu') or has_perm('drinks'));

-- The buyer's email, remembered between orders. app_settings is otherwise
-- marketing-only, so this widens it to exactly one key rather than the table -
-- the Instagram access token lives in here too.
drop policy if exists "app_settings order email" on app_settings;
create policy "app_settings order email" on app_settings
  for all using (key = 'order_email' and (has_perm('menu') or has_perm('drinks')))
  with check (key = 'order_email' and (has_perm('menu') or has_perm('drinks')));

-- ── Wines ────────────────────────────────────────────────────────────────────
-- Straight from the cellar, so the catalogue starts complete and stays true to
-- the list the site prints. Verified: these are the venue's own rows.
insert into order_items (category, name, unit, note, position, verified)
select
  'wine',
  w.producer || case when w.name is not null and w.name <> w.producer then ' - ' || w.name else '' end,
  'bottle',
  nullif(concat_ws(' · ', w.vintage::text, nullif(w.region, ''), nullif(w.country, '')), ''),
  row_number() over (order by w.colour, w.position),
  true
from wines w
where not exists (select 1 from order_items o where o.category = 'wine');

-- ── Bar stock ────────────────────────────────────────────────────────────────
-- The beers, spirits, softs and mixers the bar actually buys. Wine by the glass
-- is left out: those bottles are already in the cellar list above.
insert into order_items (category, name, unit, note, position, verified)
select 'drink', name, unit, note, 1000 + row_number() over (), true
from (values
  ('IJwit', 'crate', 'Amsterdam brewery'),
  ('Tank 7', 'crate', null),
  ('Duvel', 'crate', null),
  ('Tripel d''Anvers', 'crate', null),
  ('Bavik Super Pils', 'crate', null),
  ('Duchesse de Bourgogne', 'crate', 'West-Flemish red brown ale'),
  ('Tipsy Silver', 'crate', '0% alcohol-free blond'),
  ('Unplugged - ''t Verzet', 'crate', '0% alcohol-free hazy IPA'),
  ('The Perfect Bulldog gin', 'bottle', null),
  ('Marula Pomegranate gin', 'bottle', null),
  ('Gin Mare', 'bottle', null),
  ('Copperhead gin', 'bottle', null),
  ('Copperhead 0.0 gin', 'bottle', 'alcohol-free'),
  ('Antverpia gin', 'bottle', null),
  ('Andresen 10 Year Old White Port', 'bottle', null),
  ('Amaretto', 'bottle', null),
  ('Limoncello', 'bottle', null),
  ('Maderista - Madeira Reserva Dry', 'bottle', null),
  ('Dr. Loosen Riesling Kabinett', 'bottle', 'Mosel, Germany'),
  ('Belvedere Vodka', 'bottle', null),
  ('Mezcal Del Maguey Vida', 'bottle', null),
  ('Talisker 10Y', 'bottle', null),
  ('Wild Turkey 101', 'bottle', null),
  ('Bushmills', 'bottle', null),
  ('Campari', 'bottle', null),
  ('Aperol', 'bottle', null),
  ('Crodino N.A.', 'crate', 'alcohol-free aperitif'),
  ('Chaudfontaine still 250ml', 'crate', null),
  ('Chaudfontaine sparkling 250ml', 'crate', null),
  ('Chaudfontaine still 500ml', 'crate', null),
  ('Chaudfontaine sparkling 500ml', 'crate', null),
  ('Coca-Cola', 'crate', null),
  ('Coca-Cola Zero', 'crate', null),
  ('Sprite', 'crate', null),
  ('Ice tea', 'crate', null),
  ('Fever-Tree Mediterranean tonic', 'crate', null),
  ('Fever-Tree ginger beer', 'crate', null),
  ('JARR ginger kombucha', 'crate', null)
) as t(name, unit, note)
where not exists (select 1 from order_items o where o.category = 'drink');

-- Cocktail components. Unverified: the bar list names eleven cocktails and
-- records a recipe for only some of them, so these come from the standard build
-- of each drink rather than from Ta-nnin's own spec.
insert into order_items (category, name, unit, note, position, verified)
select 'drink', name, unit, note, 2000 + row_number() over (), false
from (values
  ('Sweet vermouth', 'bottle', 'Negroni'),
  ('Prosecco / sparkling wine for spritz', 'bottle', 'Aperol & Campari Spritz'),
  ('Soda water', 'crate', 'spritz, skinny list'),
  ('Dark rum', 'bottle', 'Dark & Stormy'),
  ('0% rum', 'bottle', 'Sober Dark & Stormy'),
  ('Vanilla vodka', 'bottle', 'Porn Star Martini'),
  ('Coffee liqueur', 'bottle', 'Espresso Martini'),
  ('Espresso beans', 'kg', 'Espresso Martini'),
  ('Grilled pineapple tequila', 'bottle', 'Lilo Negroni'),
  ('Amaro Montenegro', 'bottle', 'Lilo Negroni'),
  ('Mandarinetto', 'bottle', 'Lilo Mai Tai'),
  ('Verveine brut syrup', 'bottle', 'Verveine Sparkler'),
  ('Violet syrup', 'bottle', 'Lazy Red Cheeks'),
  ('Cane sugar syrup', 'bottle', 'Lazy Red Cheeks'),
  ('Passion fruit', 'kg', 'Porn Star Martini'),
  ('Raspberries', 'punnet', 'Lazy Red Cheeks'),
  ('Limes', 'kg', 'mule, stormy, laab, skinny list'),
  ('Lemons', 'kg', 'Mai Tai, tagliolini, posset'),
  ('Oranges', 'kg', 'spritz garnish'),
  ('Blood orange', 'kg', 'Paloma'),
  ('Grapefruit', 'kg', 'Paloma'),
  ('Fresh ginger', 'kg', 'Spicy Mule'),
  ('Fresh mint', 'bunch', 'garnish'),
  ('Red chilli', 'kg', 'Paloma, Spicy Mule'),
  ('Ice', 'bag', null)
) as t(name, unit, note)
where not exists (select 1 from order_items o where o.category = 'drink' and o.verified = false);

-- ── Food ─────────────────────────────────────────────────────────────────────
-- Every one of these is unverified. The menu records a dish name and a garnish
-- note - "Steak tartare / Egg yolk" - never a recipe, so this list is the
-- standard build of each dish on the card. It is meant to be edited down and
-- corrected by whoever actually cooks it.
insert into order_items (category, name, unit, note, position, verified)
select 'food', name, unit, note, row_number() over (), false
from (values
  -- Small bites
  ('Smoked almonds', 'kg', 'Salt pepper & smoked almonds'),
  ('Gordal olives', 'kg', 'from Priorat, Spain'),
  ('Sourdough bread', 'loaf', 'Bread & butter, focaccia service'),
  ('Butter', 'kg', 'Bread & butter'),
  ('White miso', 'kg', 'Caramelized onion miso'),
  ('Onions', 'kg', 'miso butter, pickles'),
  ('Chickpeas', 'kg', 'Hummus tandoori'),
  ('Tahini', 'kg', 'Hummus tandoori'),
  ('Tandoori spice', 'kg', 'Hummus tandoori'),
  ('Papadums', 'box', 'Hummus tandoori'),
  ('Padrón peppers', 'kg', 'Pimientos de Padrón'),
  ('Sea salt flakes', 'kg', 'Padrón, seasoning'),
  ('Olive oil', 'litre', 'throughout'),
  -- Ta-nnin classics
  ('Chicken thigh', 'kg', 'Japanese crispy chicken'),
  ('Potato starch', 'kg', 'crispy chicken coating'),
  ('Sriracha', 'bottle', 'yellow sriracha dressing'),
  ('Mayonnaise', 'kg', 'dressings, fries'),
  ('Beef mince', 'kg', 'Korean beef gyoza'),
  ('Gyoza wrappers', 'pack', 'Korean beef gyoza'),
  ('Okonomiyaki sauce', 'bottle', 'Korean beef gyoza'),
  ('Bonito flakes', 'pack', 'gyoza garnish'),
  ('Herve cheese', 'kg', 'Cheese croquette'),
  ('Parmesan', 'kg', 'croquette, sweet potato fries, tagliolini'),
  ('Breadcrumbs', 'kg', 'croquettes'),
  ('Eggs', 'tray', 'croquettes, tartare, tanninmisu'),
  ('Plain flour', 'kg', 'croquettes, crumble'),
  ('Pulled pork', 'kg', 'Ta-nnin croquette'),
  -- Cheese & cuts
  ('Cheese selection', 'kg', 'Van Tricht - platter & afterhours'),
  ('Charcuterie selection', 'kg', 'Cold cut & mixed platter'),
  ('Ibérico ham', 'kg', 'Ibérico cold cuts'),
  ('Secreto pork', 'kg', 'De Laet & Van Haver, 100gr portions'),
  ('Ibérico pluma', 'kg', 'Ibérico pluma ± 350gr'),
  ('Salame', 'kg', 'Salame market - afterhours'),
  ('Sardines tinned', 'tin', 'Sardinha - afterhours'),
  ('Crackers', 'box', 'served with the afterhours plates'),
  -- Tasty starters
  ('Duck breast', 'kg', 'Crispy duck salad'),
  ('Mixed salad leaves', 'kg', 'salads'),
  ('Sesame seeds', 'kg', 'sesame dressing'),
  ('Sesame oil', 'litre', 'sesame dressing, burnt tuna'),
  ('Mie noodles', 'pack', 'crispy mie'),
  ('Tuna loin', 'kg', 'Burnt tuna'),
  ('Ponzu', 'bottle', 'Burnt tuna'),
  ('Furikake', 'pack', 'Burnt tuna'),
  ('Avocado', 'piece', 'Burnt tuna, Saveur d''antan'),
  ('Beef tenderloin', 'kg', 'Steak tartare'),
  ('Capers', 'jar', 'Steak tartare'),
  ('Shallots', 'kg', 'tartare, pickled shallot'),
  ('Dijon mustard', 'jar', 'tartare, vinaigrette, chicory'),
  ('Cornichons', 'jar', 'Steak tartare'),
  ('Worcestershire sauce', 'bottle', 'Steak tartare'),
  ('Tabasco', 'bottle', 'Steak tartare'),
  ('Artichokes', 'kg', 'Artichoke flower'),
  ('Focaccia', 'piece', 'Focaccia mortadella'),
  ('Mortadella', 'kg', 'Focaccia mortadella'),
  ('Pistachios', 'kg', 'pistachio pesto'),
  ('Basil', 'bunch', 'pesto, tagliolini, Saveur d''antan'),
  ('Stracciatella', 'kg', 'Focaccia mortadella'),
  -- Salads
  ('Tomatoes Saveur d''antan', 'kg', 'Saveur d''antan'),
  ('Chicory', 'kg', 'Chicory salad'),
  ('Apples', 'kg', 'Chicory salad'),
  ('Crispy lettuce', 'piece', 'Crispy lettuce'),
  ('Chives', 'bunch', 'Crispy lettuce'),
  ('White wine vinegar', 'litre', 'pickling, vinaigrette'),
  -- From land & sea
  ('Entrecôte', 'kg', 'Tagliata carima ± 300gr'),
  ('Flat parsley', 'bunch', 'chimichurri, gambas'),
  ('Dried oregano', 'pack', 'chimichurri'),
  ('Red wine vinegar', 'litre', 'chimichurri'),
  ('Garlic', 'kg', 'throughout'),
  ('Gambas', 'kg', 'Gamba''s à la plancha'),
  ('Salmon fillet', 'kg', 'Spicy salmon'),
  ('Fish sauce', 'bottle', 'Thai laab'),
  ('Coriander', 'bunch', 'laab, mussels'),
  ('Mussels', 'kg', 'Steamed mussels'),
  ('Lemongrass', 'kg', 'Thai style mussels'),
  ('Galangal', 'kg', 'Thai style mussels'),
  ('Coconut milk', 'tin', 'Thai style mussels'),
  ('Kaffir lime leaves', 'pack', 'Thai style mussels'),
  ('Belgian pickles', 'jar', 'Ibérico pluma'),
  ('Tagliolini', 'kg', 'Tagliolini al limone'),
  ('Cream', 'litre', 'tagliolini, lemon posset'),
  -- Sides
  ('Potatoes for frying', 'kg', 'Potato fries'),
  ('Sweet potatoes', 'kg', 'Sweet potato fries'),
  ('Frying oil', 'litre', 'fries, croquettes'),
  ('Mustard seeds', 'jar', 'homemade mayo'),
  ('Truffle mayonnaise', 'kg', 'Sweet potato fries'),
  -- Sweet
  ('Mascarpone', 'kg', 'Tanninmisu'),
  ('Savoiardi biscuits', 'pack', 'Tanninmisu'),
  ('Cocoa powder', 'kg', 'Tanninmisu'),
  ('Marsala', 'bottle', 'Tanninmisu'),
  ('Caster sugar', 'kg', 'posset, crumble'),
  ('Pineapple', 'piece', 'Lemon posset')
) as t(name, unit, note)
where not exists (select 1 from order_items o where o.category = 'food');

-- The only supplier links the existing data actually supports: the menu names
-- Van Tricht on the cheese and De Laet & Van Haver on the Secreto. Everything
-- else stays unassigned rather than guessed.
update order_items set supplier_id = (select id from order_suppliers where name = 'Van Tricht')
where category = 'food' and name = 'Cheese selection';

update order_items set supplier_id = (select id from order_suppliers where name = 'De Laet & Van Haver')
where category = 'food' and name in ('Secreto pork', 'Ibérico pluma', 'Ibérico ham');

-- ╭─ 0050_order_history.sql ──────────────────────────────────────────────────

-- Every list that went out, kept.
--
-- A snapshot in jsonb rather than foreign keys back into order_items. What was
-- ordered on a Tuesday must still read the same next month, and products get
-- renamed, reassigned to another supplier, or archived when the bar stops
-- buying them. Rows that point at a live catalogue would quietly rewrite their
-- own history every time somebody tidied it - and the one question this table
-- exists to answer is "what did we actually order".
--
-- `method` records how it left: printed, or mailed to an address. Print is
-- recorded when the sheet is generated, which is the moment the buyer acted on
-- it; whether the paper actually came out of the printer is not something a
-- web page is told.

create table if not exists order_history (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  method     text not null check (method in ('print', 'email')),
  -- The address for an emailed list, null for a printed one.
  recipient  text,
  -- [{ label, rows: [{ name, unit, note, quantity }] }] - the sheet as it went.
  lines      jsonb not null,
  line_count integer not null default 0,
  -- Who sent it. The id for the durable link, and the name as it read at the
  -- time - staff leave and get renamed, and "who ordered this" should not
  -- become "unknown" or, worse, somebody else when the table is tidied.
  created_by      uuid,
  created_by_name text
);

create index if not exists order_history_created_at_idx on order_history (created_at desc);

alter table order_history enable row level security;

-- Same rights as the ordering screen itself: kitchen and bar both buy.
drop policy if exists "order_history staff" on order_history;
create policy "order_history staff" on order_history
  for all using (has_perm('menu') or has_perm('drinks'))
  with check (has_perm('menu') or has_perm('drinks'));

-- Stamped by the database, not the browser.
--
-- A client that supplies its own author can supply anybody else's, and one
-- that forgets leaves a record nobody owns. security definer so the lookup can
-- read `staff` regardless of the caller's own rights - it returns one name,
-- and only ever the caller's.
create or replace function order_history_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  new.created_by_name := (
    select coalesce(nullif(full_name, ''), email)
    from staff
    where user_id = auth.uid()
  );
  return new;
end
$$;

drop trigger if exists order_history_stamp on order_history;
create trigger order_history_stamp
  before insert on order_history
  for each row execute function order_history_stamp();

-- ╭─ 0051_order_list_split.sql ───────────────────────────────────────────────

-- Three lists, not one basket.
--
-- The first cut shared a single shopping list across wines, drinks and food and
-- grouped it under headings. That is one shopping trip, which is not how this
-- bar buys: the cellar, the bar and the kitchen are ordered separately, by
-- different people, on different days. So each tab now keeps its own list, and
-- prints and mails its own sheet.
--
-- No change to `order_list_items` itself - a line already belongs to a category
-- through the product it points at, so "the food list" is simply the lines whose
-- product is food. Adding a category column here would be a second, copyable
-- answer to a question the data already answers once.
--
-- `order_history` does need it. A filed list is a snapshot with no live link
-- back to the catalogue, so without this it could not say which of the three it
-- was - and "Food, Tuesday 14:20" is most of what makes the record findable.

alter table order_history add column if not exists category text
  check (category is null or category in ('wine', 'drink', 'food'));

comment on column order_history.category is
  'Which of the three lists this was. Null only for records filed before the lists were split.';

-- ╭─ 0052_order_finalise.sql ─────────────────────────────────────────────────

-- One row per order, not one per time it left the building.
--
-- The first cut filed a record on each print and each email, so an order that
-- was printed for the trolley and mailed to the buyer appeared twice, thirty
-- seconds apart, looking like two orders. The log answers "what did we order",
-- and the answer is one order however many ways it came out.
--
-- So the order is filed once, when the buyer finalises it, and printing or
-- mailing stamps that same row. `method` is replaced by two timestamps: it
-- could only ever hold one answer, and an order is commonly both.
--
-- Finalising also fixes what the sheet says. Print and email render the stored
-- snapshot rather than the live list, so what comes out of the printer is what
-- the log says was ordered - not whatever the basket happened to contain by the
-- time somebody got to it.

alter table order_history add column if not exists printed_at timestamptz;
alter table order_history add column if not exists emailed_at timestamptz;

-- Existing records keep their meaning: the one thing they recorded becomes the
-- timestamp for that one thing.
--
-- Guarded and executed dynamically so the whole file can be applied twice. The
-- column is dropped below, and a second run would otherwise fail parsing an
-- update against a column that is no longer there.
do $mig$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_history' and column_name = 'method'
  ) then
    execute 'update order_history set printed_at = created_at where method = ''print'' and printed_at is null';
    execute 'update order_history set emailed_at = created_at where method = ''email'' and emailed_at is null';
  end if;
end $mig$;
-- Two rows that were one order stay two rows. They are a true record of what
-- happened under the old scheme, and rewriting history to match a later design
-- is exactly what this table is built not to do.
alter table order_history drop column if exists method;

comment on column order_history.printed_at is 'When the sheet was generated, null if never printed.';
comment on column order_history.emailed_at is 'When it was last mailed, null if never emailed.';

-- ╭─ 0053_gift_vouchers.sql ──────────────────────────────────────────────────

-- Gift vouchers, sold online and over the bar, redeemed at the bar.
--
--   gift_vouchers             one row per voucher: value, what is left on it,
--                             who it is for, and how it was paid for
--   gift_voucher_redemptions  every time some of it is spent, and by whom
--
-- A voucher can be spent over several visits, so `balance_cents` goes down and
-- the redemptions are the ledger behind it. Nobody writes either table
-- directly: staff go through the functions below, which lock the row and check
-- the balance in one step, so two people redeeming the same card at the same
-- moment cannot both spend the last 20 euros.
--
-- Online sales arrive through Stripe. The website stores a `pending` row before
-- sending the buyer to pay, and only once Stripe confirms the payment does
-- `activate_gift_voucher` give it a code. A pending row is not a voucher: it
-- has no code, so there is nothing to redeem.

-- 1. A `vouchers` permission, for whoever works the till.
alter table staff drop constraint if exists staff_permissions_check;
alter table staff add constraint staff_permissions_check check (
  permissions <@ array['sold_out', 'menu', 'drinks', 'bookings', 'tables', 'people', 'marketing', 'vouchers']::text[]
);

-- Whoever manages people gets it once, so the owner can use it immediately.
update staff
  set permissions = array_append(permissions, 'vouchers')
  where 'people' = any(permissions) and not ('vouchers' = any(permissions));

-- 2. The vouchers.
create table if not exists gift_vouchers (
  id                    uuid primary key default gen_random_uuid(),
  -- Five digits from 10000, null until paid for.
  code                  text unique,
  -- 5 to 1000 euros: wider than the website offers (20 minimum), so a bar sale
  -- is never refused for being an unusual amount.
  amount_cents          int not null check (amount_cents between 500 and 100000),
  balance_cents         int not null,
  status                text not null default 'pending' check (status in ('pending', 'active', 'void')),
  source                text not null check (source in ('online', 'bar')),
  recipient_name        text check (char_length(recipient_name) <= 60),
  from_name             text check (char_length(from_name) <= 60),
  note                  text check (char_length(note) <= 160),
  buyer_email           text check (char_length(buyer_email) <= 254),
  -- Set when the buyer chose to send the voucher straight to the recipient.
  recipient_email       text check (char_length(recipient_email) <= 254),
  recipient_emailed_at  timestamptz,
  locale                text not null default 'en' check (locale in ('en', 'nl')),
  valid_until           date,
  stripe_session_id     text unique,
  stripe_payment_intent text,
  emailed_at            timestamptz,
  issued_by             uuid references auth.users (id) on delete set null,
  void_reason           text check (char_length(void_reason) <= 160),
  created_at            timestamptz not null default now(),
  activated_at          timestamptz,
  voided_at             timestamptz,
  constraint gift_vouchers_balance check (balance_cents between 0 and amount_cents),
  constraint gift_vouchers_active_complete check (status <> 'active' or (code is not null and valid_until is not null))
);

create index if not exists gift_vouchers_created_idx on gift_vouchers (created_at desc);
create index if not exists gift_vouchers_payment_idx on gift_vouchers (stripe_payment_intent);

create table if not exists gift_voucher_redemptions (
  id           uuid primary key default gen_random_uuid(),
  voucher_id   uuid not null references gift_vouchers (id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  staff_id     uuid references auth.users (id) on delete set null,
  note         text check (char_length(note) <= 160),
  created_at   timestamptz not null default now()
);

create index if not exists gift_voucher_redemptions_voucher_idx on gift_voucher_redemptions (voucher_id, created_at desc);

-- Read-only to staff with the permission; the public key sees nothing at all.
-- No write policies, on purpose: every change goes through a function below.
alter table gift_vouchers enable row level security;
alter table gift_voucher_redemptions enable row level security;

drop policy if exists "gift_vouchers staff read" on gift_vouchers;
create policy "gift_vouchers staff read" on gift_vouchers
  for select using (has_perm('vouchers'));

drop policy if exists "gift_voucher_redemptions staff read" on gift_voucher_redemptions;
create policy "gift_voucher_redemptions staff read" on gift_voucher_redemptions
  for select using (has_perm('vouchers'));

-- 3. Codes.
--
-- Five digits, counting up from 10000, so a voucher is short to read out or
-- type at the bar. Codes are not guessable by design: redeeming one needs
-- staff with the `vouchers` permission, and nothing on the public site can look
-- a code up. The sequence is the only source of numbers, so no two vouchers
-- can share one.
create sequence if not exists gift_voucher_number_seq start with 10000 minvalue 10000;

create or replace function gift_voucher_code()
returns text
language sql
volatile
security definer
set search_path = public
as $$ select nextval('gift_voucher_number_seq')::text $$;

revoke execute on function gift_voucher_code() from public;

-- Today in Antwerp, so a voucher does not expire an hour early in winter.
create or replace function gift_voucher_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Europe/Brussels')::date $$;

-- Whatever staff typed, as five digits. Mirrors normaliseVoucherCode.
create or replace function gift_voucher_normalise(in_code text)
returns text
language plpgsql
immutable
as $$
declare
  s text := upper(regexp_replace(coalesce(in_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  s := regexp_replace(s, '^TN', '');
  if s !~ '^[0-9]{5}$' then return null; end if;
  return s;
end;
$$;

-- 4. Paid for online: called by the website, with the service key, once Stripe
-- says the money is in. Safe to call twice - the webhook and the thank-you page
-- both call it and either may arrive first - and the second call just returns
-- the voucher the first one made.
create or replace function activate_gift_voucher(in_id uuid, in_payment_intent text)
returns gift_vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  v gift_vouchers;
begin
  select * into v from gift_vouchers where id = in_id for update;
  if not found then
    raise exception 'No such voucher.' using errcode = 'TN010';
  end if;
  if v.status <> 'pending' then
    return v;
  end if;

  update gift_vouchers set
    status = 'active',
    code = gift_voucher_code(),
    valid_until = (gift_voucher_today() + interval '12 months')::date,
    stripe_payment_intent = coalesce(in_payment_intent, stripe_payment_intent),
    activated_at = now()
  where id = in_id
  returning * into v;

  return v;
end;
$$;

revoke execute on function activate_gift_voucher(uuid, text) from public;
grant execute on function activate_gift_voucher(uuid, text) to service_role;

-- 5. Sold over the bar: staff take the money at the till and the admin prints
-- the card, so the paper vouchers live in the same register as the online ones.
create or replace function issue_gift_voucher(
  in_amount_cents int,
  in_recipient text,
  in_from text,
  in_note text
)
returns gift_vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  v gift_vouchers;
begin
  if not has_perm('vouchers') then
    raise exception 'Staff only.' using errcode = '42501';
  end if;

  insert into gift_vouchers (
    code, amount_cents, balance_cents, status, source,
    recipient_name, from_name, note, valid_until, issued_by, activated_at
  ) values (
    gift_voucher_code(), in_amount_cents, in_amount_cents, 'active', 'bar',
    nullif(trim(in_recipient), ''), nullif(trim(in_from), ''), nullif(trim(in_note), ''),
    (gift_voucher_today() + interval '12 months')::date, auth.uid(), now()
  )
  returning * into v;

  return v;
end;
$$;

revoke execute on function issue_gift_voucher(int, text, text, text) from public;
grant execute on function issue_gift_voucher(int, text, text, text) to authenticated;

-- 6. Spending it. Each refusal has its own SQLSTATE so the admin can say
-- exactly what is wrong without matching on English:
--   TN010 no such code     TN011 voided      TN012 expired
--   TN013 not an amount    TN014 more than is left on it
create or replace function redeem_gift_voucher(in_code text, in_amount_cents int, in_note text)
returns gift_vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  v gift_vouchers;
begin
  if not has_perm('vouchers') then
    raise exception 'Staff only.' using errcode = '42501';
  end if;

  select * into v from gift_vouchers
    where code = gift_voucher_normalise(in_code) and status <> 'pending'
    for update;

  if not found then
    raise exception 'No voucher with that code.' using errcode = 'TN010';
  end if;
  if v.status = 'void' then
    raise exception 'This voucher has been cancelled.' using errcode = 'TN011';
  end if;
  if v.valid_until < gift_voucher_today() then
    raise exception 'This voucher expired on %.', to_char(v.valid_until, 'DD/MM/YYYY') using errcode = 'TN012';
  end if;
  if in_amount_cents is null or in_amount_cents <= 0 then
    raise exception 'Enter the amount to take off.' using errcode = 'TN013';
  end if;
  if in_amount_cents > v.balance_cents then
    raise exception 'Only % cents left on this voucher.', v.balance_cents using errcode = 'TN014';
  end if;

  insert into gift_voucher_redemptions (voucher_id, amount_cents, staff_id, note)
    values (v.id, in_amount_cents, auth.uid(), nullif(trim(in_note), ''));

  update gift_vouchers set balance_cents = balance_cents - in_amount_cents
    where id = v.id
    returning * into v;

  return v;
end;
$$;

revoke execute on function redeem_gift_voucher(text, int, text) from public;
grant execute on function redeem_gift_voucher(text, int, text) to authenticated;

-- 7. Cancelling one: a refund, a mistake at the till, a lost card reissued.
-- The row stays, so the register still adds up.
create or replace function void_gift_voucher(in_id uuid, in_reason text)
returns gift_vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  v gift_vouchers;
begin
  if not has_perm('vouchers') then
    raise exception 'Staff only.' using errcode = '42501';
  end if;

  update gift_vouchers set
    status = 'void',
    voided_at = now(),
    void_reason = nullif(trim(in_reason), '')
  where id = in_id and status = 'active'
  returning * into v;

  if not found then
    raise exception 'No active voucher to cancel.' using errcode = 'TN010';
  end if;

  return v;
end;
$$;

revoke execute on function void_gift_voucher(uuid, text) from public;
grant execute on function void_gift_voucher(uuid, text) to authenticated;

-- ╭─ 0054_gift_voucher_cap.sql ───────────────────────────────────────────────

-- Gift vouchers: raise the ceiling from 1000 to 3000 euros (Sacha, 2026-11-07).
-- The website takes 20 to 3000; the bar can still issue from 5.
alter table gift_vouchers drop constraint if exists gift_vouchers_amount_cents_check;
alter table gift_vouchers add constraint gift_vouchers_amount_cents_check
  check (amount_cents between 500 and 300000);

-- ╭─ 0055_site_content.sql ───────────────────────────────────────────────────

-- Site texts and pages, edited in the admin (Admin > Texts, Admin > Pages).
--
-- Brought over from the 58diamonds admin. Every text is a jsonb object
-- { "en": ..., "nl": ..., "fr": ... }; a language left out falls back to the
-- wording in the code (packages/content/messages), then to English.
--
-- Public read, so the website (anon key) can lay the edits over its own
-- texts; only the marketing permission writes, like events and social.

-- 1. Edits to the site's own texts, keyed by the message path ("about.heading").
--    No row means the wording in the code shows. Deleting a row puts it back.
create table if not exists site_texts (
  key        text        primary key check (key ~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$'),
  value      jsonb       not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  updated_at timestamptz not null default now()
);

alter table site_texts enable row level security;

drop policy if exists "site texts public read" on site_texts;
create policy "site texts public read" on site_texts
  for select using (true);

drop policy if exists "marketing write site texts" on site_texts;
create policy "marketing write site texts" on site_texts
  for all using (has_perm('marketing')) with check (has_perm('marketing'));

-- 2. Pages staff add themselves (a private-events page, a jobs page...),
--    at ta-nnin.be/<slug>, /nl/<slug> and /fr/<slug>. `body` is simple
--    Markdown per language. A new page starts as a draft.
create table if not exists pages (
  id               uuid        primary key default gen_random_uuid(),
  slug             text        not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            jsonb       not null default '{}'::jsonb,
  body             jsonb       not null default '{}'::jsonb,
  image_url        text,
  seo_title        jsonb       not null default '{}'::jsonb,
  seo_description  jsonb       not null default '{}'::jsonb,
  published        boolean     not null default false,
  in_footer        boolean     not null default false,
  position         int         not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists pages_position_idx on pages (position);

alter table pages enable row level security;

-- Published pages are public; staff see drafts too.
drop policy if exists "pages public read" on pages;
create policy "pages public read" on pages
  for select using (published = true or is_staff());

drop policy if exists "marketing write pages" on pages;
create policy "marketing write pages" on pages
  for all using (has_perm('marketing')) with check (has_perm('marketing'));

-- ╭─ 0056_on_menu.sql ────────────────────────────────────────────────────────

-- Off the menu, not deleted.
--
-- The food menu, the bar list and the wine list change with the season, and
-- dishes and bottles come back. Deleting a row loses its notes, grapes and
-- position; marking it sold out keeps it on the website (greyed out). This
-- flag hides a row from the website and the printed menus while the admin
-- keeps it, with a button to put it back.

alter table menu_items add column if not exists on_menu boolean not null default true;
alter table drinks     add column if not exists on_menu boolean not null default true;
alter table wines      add column if not exists on_menu boolean not null default true;

-- ╭─ seed.sql ───────────────────────────────────────────────────────────────

-- Seed data for Ta-nnin.
-- GENERATED by scripts/generate-seed.mjs - do not edit by hand.
-- Run after 0001_init.sql. Safe to re-run: it truncates first.

begin;

truncate menu_items, menu_sections, wines, drinks, drink_sections restart identity cascade;

-- menu sections and items, from both printed cards
insert into menu_sections (id, title, service, position) values ('small-bites', 'Small bites', 'kitchen', 0);
insert into menu_sections (id, title, service, position) values ('classics', 'Ta-nnin classics', 'kitchen', 1);
insert into menu_sections (id, title, service, position) values ('cheese-cuts', 'Cheese & cuts', 'kitchen', 2);
insert into menu_sections (id, title, service, position) values ('starters', 'Tasty starters', 'kitchen', 3);
insert into menu_sections (id, title, service, position) values ('salads', 'Not just a side salad', 'kitchen', 4);
insert into menu_sections (id, title, service, position) values ('land-sea', 'From land & sea', 'kitchen', 5);
insert into menu_sections (id, title, service, position) values ('sides', 'Crispy & comforting sides', 'kitchen', 6);
insert into menu_sections (id, title, service, position) values ('sweet', 'Sweet treats', 'kitchen', 7);
insert into menu_sections (id, title, service, position) values ('afterhours', 'The afterhours menu', 'afterhours', 8);

insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('small-bites', 'Salt pepper & smoked almonds', NULL, 5.5, NULL, false, 0);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('small-bites', 'Gordal olives', 'from Priorat, Spain', 5.5, NULL, false, 1);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('small-bites', 'Bread & butter', 'Caramelized onion miso', 5.5, NULL, false, 2);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('small-bites', 'Hummus tandoori', 'Papadums', 13, NULL, false, 3);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('small-bites', 'Pimientos de Padrón', 'Sea salt flakes', 12, NULL, false, 4);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('classics', 'Japanese crispy chicken', 'Yellow sriracha dressing', 16, NULL, false, 0);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('classics', 'Korean beef gyoza', 'Okonomiyaki sauce', 15, NULL, false, 1);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('classics', 'Cheese croquette', 'Herve - parmesan', 13, NULL, false, 2);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('classics', 'Ta-nnin croquette', 'Ibérico - pulled pork', 14, NULL, false, 3);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('cheese-cuts', 'Cheese platter', 'Selected by Van Tricht', 19, NULL, false, 0);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('cheese-cuts', 'Cold cut platter', 'Selected charcuterie', 19, NULL, false, 1);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('cheese-cuts', 'Mixed platter', 'Charcuterie & cheese', 22, NULL, false, 2);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('cheese-cuts', 'The famous Secreto 07', 'De Laet & Van Haver, 100 gram', 21, NULL, false, 3);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('starters', 'Crispy duck salad', 'Sesame dressing - crispy mie', 16, NULL, false, 0);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('starters', 'Burnt tuna', 'Ponzu - furikake - avocado', 17, NULL, false, 1);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('starters', 'Steak tartare', 'Egg yolk', 17, NULL, false, 2);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('starters', 'Artichoke flower', 'Mustard vinaigrette', 12, NULL, false, 3);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('starters', 'Focaccia mortadella', 'Pistachio pesto - stracciatella', 14, NULL, false, 4);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('salads', 'Saveur d''antan', 'Tomato water - basil - avocado', 10, NULL, false, 0);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('salads', 'Chicory', 'Mustard - apple', 8, NULL, false, 1);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('salads', 'Crispy lettuce', 'Pickled shallot - chives', 7, NULL, false, 2);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('land-sea', 'Tagliata carima ± 300gr', 'Entrecôte - chimichurri', 34, NULL, false, 0);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('land-sea', 'Gamba''s à la plancha', 'Chili - garlic', 18, NULL, false, 1);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('land-sea', 'Spicy salmon', 'Thai laab style', 17, NULL, false, 2);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('land-sea', 'Steamed mussels', 'Thai style', 19, NULL, false, 3);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('land-sea', 'Ibérico pluma ± 350gr', 'Belgian pickles', 28, NULL, false, 4);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('land-sea', 'Tagliolini al limone', 'Lemon basil sauce', 18, NULL, false, 5);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('sides', 'Potato fries', 'Homemade mayo - mustard seeds', 12, NULL, false, 0);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('sides', 'Sweet potato fries', 'Truffle mayo - parmesan', 12, NULL, false, 1);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('sweet', 'Tanninmisu', NULL, 7, NULL, false, 0);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('sweet', 'Lemon posset', 'Crumble - pineapple', 8.5, NULL, false, 1);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('afterhours', 'Salt pepper & smoked almonds', NULL, 5.5, NULL, false, 0);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('afterhours', 'Gordal olives', 'From Priorat, Spain', 5.5, NULL, false, 1);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('afterhours', 'Hummus tandoori', NULL, 9, NULL, true, 2);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('afterhours', 'Cheese from Van Tricht', 'Ask our selection', 13, NULL, true, 3);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('afterhours', 'Ibérico cold cuts', 'Ask our selection', 11, 16, true, 4);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('afterhours', 'Salame market', 'Ask our flavors', 9, NULL, true, 5);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('afterhours', 'Sardinha', 'Different flavors', 9.5, NULL, false, 6);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('afterhours', 'Tanninmisu', NULL, 7, NULL, false, 7);
insert into menu_items (section_id, name, note, price, price_max, with_crackers, position) values ('afterhours', 'Lemon posset', NULL, 8.5, NULL, false, 8);

-- the cellar: 167 bottles
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Champagne', 'Ta-nnin Label', 'sparkling', 'France', 'Champagne', ARRAY['Chardonnay', 'Pinot Noir']::text[], NULL, 67, 0);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Brut Sainte Anne', 'Chartogne-Taillet', 'sparkling', 'France', 'Champagne', ARRAY['Pinot Noir', 'Chardonnay', 'Pinot Meunier']::text[], NULL, 92.5, 1);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Collection 246', 'Louis Roederer', 'sparkling', 'France', 'Champagne', ARRAY['Chardonnay', 'Pinot Noir', 'Pinot Meunier']::text[], NULL, 95, 2);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Héritage Blanc de Meunier', 'André Heucq', 'sparkling', 'France', 'Champagne', ARRAY['Pinot Meunier']::text[], 2019, 84, 3);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('C. de Chardonnay Premier Cru Brut', 'Perseval Farge', 'sparkling', 'France', 'Champagne', '{}', NULL, 89, 4);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Brut Reserva', 'Mont Marçal', 'sparkling', 'Spain', 'Penedès', ARRAY['Macabeo', 'Xarel·lo', 'Parellada', 'Chardonnay']::text[], NULL, 36, 5);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('PetNat Rosé', 'Gabernik23', 'sparkling', 'Slovenia', 'Štajerska', ARRAY['Blaufränkisch']::text[], 2022, 41, 6);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Rebolium Brut', 'Sinefinis', 'sparkling', 'Slovenia x Italy', NULL, ARRAY['Rebula']::text[], 2020, 55, 7);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Rosé ‘Vom Opok’', 'Weingut Muster', 'rose', 'Austria', 'Styria', ARRAY['Blauer Wildbacher']::text[], 2020, 59, 8);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Tesch Deep Blue Trocken', 'Tesch Deep Blue Trocken', 'rose', 'Germany', 'Nahe', ARRAY['Pinot Noir']::text[], 2023, 34, 9);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Fusion Pelliculaire', 'Dom. Mann', 'rose', 'France', 'Alsace', ARRAY['Field Blend']::text[], 2022, 44.4, 10);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Clairet', 'Château Martet', 'rose', 'France', 'Bordeaux', ARRAY['Clairet']::text[], 2024, 31, 11);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('the Three G', 'François Ducrot', 'rose', 'France', 'Languedoc', ARRAY['Grenache Blanc', 'Grenache Gris', 'Grenache Noir']::text[], NULL, 36.5, 12);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('D.', 'Dom. de la Dourbie', 'rose', 'France', 'Langeudoc', ARRAY['Grenache Noir', 'Cinsault', 'Syrah', 'Mourvèdre']::text[], 2023, 39.5, 13);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Audace', 'Pas du Cerf', 'rose', 'France', 'Provence', ARRAY['Grenache', 'Mourvèdre']::text[], 2022, 48.5, 14);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Les Accoles Le Rose des Acolytes', 'Les Accoles Le Rose des Acolytes', 'rose', 'Vin de France', NULL, ARRAY['Grenache', 'Cabernet Sauvignon']::text[], 2021, 37.5, 15);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('La Culottée', 'Ventenac', 'rose', 'Vin de France', NULL, ARRAY['Caladoc']::text[], 2024, 33, 16);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Rosé Vulcânico', 'Maçanita', 'rose', 'Portugal', 'Açores', ARRAY['Castelão', 'Aragonez']::text[], 2024, 47.5, 17);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Cuvée N°8', 'Maçanita Fitapreta', 'rose', 'Portugal', 'Alentejo', ARRAY['Castelão', 'Trincadeira', 'Aragonez']::text[], NULL, 40, 18);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Route Gris', 'Troupis Winery', 'rose', 'Mantineia', NULL, ARRAY['Moschofilero']::text[], 2024, 45, 19);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Liatiko', 'Iliana Malihin', 'rose', 'Greece', 'Rethymno', ARRAY['Liatiko']::text[], 2022, 51.5, 20);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Madreselva', 'Erazo Vineyards', 'rose', 'Chile', 'Itata Valley', ARRAY['País', 'Cinsault']::text[], 2023, 39.5, 21);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Costa Rawa', 'Anaïs Fanti', 'orange', 'France', 'Vin de France (Alsace)', ARRAY['Gewürztraminer', 'Riesling', 'Muscat']::text[], 2021, 75, 22);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Artisan', 'Vignoble du Rêveur', 'orange', 'France', 'Alsace', ARRAY['Gewürztraminer', 'Pinot Gris', 'Riesling']::text[], 2022, 48, 23);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Oníric', 'Entre Vinyes', 'orange', 'Spain', 'Penedes', ARRAY['Macabeu']::text[], 2023, 43, 24);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Enblanco de Altolandon', 'Enblanco de Altolandon', 'orange', 'Spain', 'Manchuela', ARRAY['Garnacha Blanca', 'Garnacha Gris']::text[], 2024, 39.2, 25);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Doric Wine', 'Doric Wine', 'orange', 'Greece', 'Delphi, Phocis', ARRAY['Roditis', 'Malagousia']::text[], 2024, 49, 26);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Robinia', 'Stemberger', 'orange', 'Slovenia', 'Kras', ARRAY['Vitovska']::text[], 2016, 65, 27);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Kristina Mervic Chardonnay', 'JNK', 'orange', 'Slovenia', 'Šempas', ARRAY['Chardonnay']::text[], 2015, 106, 28);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Goruli Mtsvane Dry Amber Biodynamic Wine', 'Gotsa', 'orange', 'Georgia', 'Kakheti', ARRAY['Goruli Mtsvane']::text[], 2024, 48.5, 29);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Halgans Riesling', 'Emrich Schönleber', 'white', 'Germany', 'Nahe', '{}', 2019, 66, 30);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Qvinterra Riesling Trocken', 'Kühling-Gillot', 'white', 'Germany', 'Rheinhessen', ARRAY['Riesling']::text[], 2024, 39.5, 31);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Chardonnay Réserve', 'Kühling-Gillot', 'white', 'Germany', 'Rheinhessen', ARRAY['Chardonnay']::text[], 2025, 49.5, 32);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Oppenheim Chardonnay Alte Reben', 'Kühling-Gillot', 'white', 'Germany', 'Rheinhessen', ARRAY['Chardonnay']::text[], 2024, 119, 33);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Riesling Réserve Vom Kalkstein', 'Battenfeld-Spanier', 'white', 'Germany', 'Rheinhessen', ARRAY['Riesling']::text[], 2020, 67.5, 34);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Hohen-Sülzen Riesling', 'Battenfeld-Spanier', 'white', 'Germany', 'Rheinhessen', ARRAY['Riesling']::text[], 2021, 84, 35);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Weißburgunder Réserve', 'Battenfeld-Spanier', 'white', 'Germany', 'Rheinhessen', ARRAY['Weissburgunder']::text[], 2025, 49.5, 36);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Grüner Sylvaner', 'Battenfeld-Spanier', 'white', 'Germany', 'Rheinhessen', ARRAY['Sylvaner']::text[], 2022, 49.5, 37);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Weißburgunder Vom Kalksteinfels', 'Philipp Kuhn', 'white', 'Pfalz', NULL, ARRAY['Weißburgunder']::text[], 2024, 47.9, 38);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Blauer Zweigelt', 'Dolle', 'red', 'Niederösterreich', NULL, ARRAY['Zweigelt']::text[], 2022, 32, 39);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Saint Laurent', 'Keth', 'red', 'Rheinhessen', NULL, ARRAY['St. Laurent']::text[], 2024, 32, 40);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Spätburgunder', 'Battenfeld-Spanier', 'red', 'Germany', 'Rheinhessen', ARRAY['Spätburgunder']::text[], 2022, 49.5, 41);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Schwarzer Letten', 'Stefan Meyer', 'red', 'Germany', 'Pfalz', ARRAY['Pinot Noir']::text[], 2021, 72.2, 42);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Spätburgunder Trocken 1L', 'Weingut Lebenshilfe', 'red', 'Pfalz', NULL, ARRAY['Riesling']::text[], 2024, 41, 43);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Burgreben Riesling', 'Muller-Koeberle', 'white', 'Alsace', NULL, ARRAY['Riesling']::text[], 2022, 59, 44);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Lieu-dit Altengarten Riesling', 'Dom. Mann', 'white', 'Alsace', NULL, ARRAY['Riesling']::text[], 2023, 58.5, 45);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Grand Cru Pfersigberg “Lieu-dit Sunde” Riesling', 'Dom. Mann', 'white', 'Alsace', NULL, ARRAY['Riesling']::text[], 2024, 79, 46);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Clos de la Frelonnerie', 'Stéphane Bodet', 'white', 'Montlouis sur Loire', NULL, ARRAY['Chenin Blanc']::text[], 2022, 109, 47);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Thibaud Boudignon Anjou Blanc', 'Thibaud Boudignon Anjou Blanc', 'white', 'Loire', 'Anjou', ARRAY['Chenin Blanc']::text[], 2022, 75.5, 48);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Saumur Blanc', 'Guiberteau', 'white', 'Loire', NULL, ARRAY['Chenin Blanc']::text[], 2024, 81, 49);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Clisson', 'La Pépiere', 'white', 'Muscadet-Sèvre-et-Maine', NULL, ARRAY['Melon de bourgogne']::text[], 2023, 49, 50);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Aligote', 'Ledy Vins', 'white', 'Burgundy', NULL, ARRAY['Aligote']::text[], 2024, 72.5, 51);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Aligote', 'Pierre Yves Colin Morey', 'white', 'Burgundy', NULL, ARRAY['Aligote']::text[], 2022, 79, 52);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Bourgogne Blanc', 'Armand Heitz', 'white', 'Burgundy', NULL, ARRAY['Chardonnay']::text[], 2024, 62, 53);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('“Montre Cul” Blanc', 'Chapuis & Chapuis', 'white', 'Montrecul AOP', NULL, ARRAY['Chardonnay']::text[], 2024, 71, 54);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Vincent Prunier', 'Vincent Prunier', 'white', 'Auxey-Duresses', NULL, ARRAY['Chardonnay']::text[], 2022, 63.5, 55);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Les Terrasses de Bievaux- Santenay', 'Justin Girardin', 'white', 'Burgundy', NULL, ARRAY['Chardonnay']::text[], 2023, 83, 56);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Puligny-Montrachet', 'Justin Girardin', 'white', 'Burgundy', NULL, ARRAY['Chardonnay']::text[], 2023, 206, 57);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Petite Arvine', 'Jean Charles Girard Madoux', 'white', 'Savoie', NULL, ARRAY['Petite Arvine']::text[], 2023, 52, 58);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Argile Blanc', 'Domaine des Ardoisières', 'white', 'Savoie', NULL, ARRAY['Jacquère', 'Chardonnay', 'Mondeuse Blanche']::text[], 2020, 72, 59);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Les Monettes', 'D. de Lucey', 'white', 'Savoie', NULL, ARRAY['Altesse']::text[], 2024, 56, 60);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Conti-ne Périgourdine', 'Albert de Conti', 'white', 'Bergerac', NULL, ARRAY['Muscadelle']::text[], 2022, 51, 61);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Castel Viel  Faugères', 'Prés Lasses', 'white', 'Languedoc Roussillon', NULL, ARRAY['Carignan Blanc', 'Clairette', 'Grenache Blanc', 'Roussane', 'Vermentino']::text[], 2021, 58.5, 62);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('La Colombière', 'Philippe & Diane Cauvin', 'white', 'Vin de France (SW)', NULL, ARRAY['Bouysselet']::text[], 2020, 57, 63);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('La Lluna Lieu-Dit', 'Domaine Mann', 'red', 'Alsace', NULL, ARRAY['Pinot Noir']::text[], 2021, 81, 64);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Roche Granitique', 'Dom. Kirrenbourg', 'red', 'Alsace', NULL, ARRAY['Pinot Noir']::text[], 2022, 63, 65);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Cuvée Mathieu', 'Dom. Kirrenbourg', 'red', 'Alsace', NULL, ARRAY['Pinot Noir']::text[], 2021, 95, 66);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Chinon', 'Les Graviers', 'red', 'Loire', NULL, ARRAY['Cabernet Franc']::text[], 2023, 32.5, 67);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Dom. Mochard de Gramont', 'Dom. Mochard de Gramont', 'red', 'Burgundy', NULL, ARRAY['Pinot Noir']::text[], 2024, 42, 68);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('“Montre Cul” Rouge', 'Chapuis & Chapuis', 'red', 'Montrecul AOP', NULL, ARRAY['Pinot Noir']::text[], 2024, 69, 69);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Les Longeroies â€” Marsannay', 'Domaine Jean Fournier', 'red', 'Burgundy', NULL, ARRAY['Pinot Noir']::text[], 2022, 123, 70);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Premier Cru Beauregard', 'Justin Girardin', 'red', 'Burgundy', 'Santenay', ARRAY['Pinot Noir']::text[], 2022, 98, 71);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Pommard', 'Vincent Prunier', 'red', 'Burgundy', 'Pommard', ARRAY['Pinot Noir']::text[], 2018, 95, 72);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Morgon', 'Carl Marcel Lapierre', 'red', 'Beaujolais', 'Morgon', ARRAY['Gamay']::text[], 2024, 59, 73);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Côte du Ply', 'Jean Foillard', 'red', 'Beaujolais', 'Morgon', ARRAY['Gamay']::text[], 2023, 69, 74);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Marthe Henry', 'Marthe Henry', 'red', 'Beaujolais', 'Fleurie', ARRAY['Gamay']::text[], 2021, 58.2, 75);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Obora', 'Hugo Foizel & Angéla Quiblier', 'red', 'Beaujolais', 'Chénas', ARRAY['Gamay']::text[], 2022, 56, 76);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('100% Merlot', 'VIN5', 'red', 'Bordeaux', NULL, ARRAY['Merlot']::text[], 2022, 59, 77);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Saint-Emillon Grand Cru', 'Chateau Teyssier', 'red', 'Bordeaux', NULL, ARRAY['Merlot', 'Cabernet Franc']::text[], 2020, 54, 78);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Les Éclats de Branas', 'Château Branas Grand Poujeaux', 'red', 'Bordeaux', 'Moulis-en-Médoc', ARRAY['Merlot', 'Cabernet Sauvignon', 'Petit Verdot']::text[], 2019, 34.5, 79);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Les Peyrouses', 'Alain Voge', 'red', 'Côtes du Rhône', NULL, ARRAY['Syrah']::text[], 2023, 52.4, 80);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Beautusille', 'Isabel Ferrando', 'red', 'Côte du Rhône', NULL, ARRAY['Grenache Noir', 'Cinsault']::text[], 2021, 60.5, 81);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Les Gamines', 'Domaine de la Marfée', 'red', 'Languedoc', NULL, ARRAY['Cinsault', 'Grenache']::text[], 2022, 37.7, 82);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Version', 'Domaine Recerca', 'red', 'Vin de France (Roussillon)', NULL, ARRAY['Macabeu', 'Muscat Petits Grains', 'Muscat d’Alexandria', 'Mourvèdre', 'Grenache']::text[], 2022, 48.5, 83);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Pharmakôn', 'Domaine Recerca', 'red', 'Vin de France (Roussillon)', NULL, ARRAY['Syrah', 'Muscat']::text[], 2022, 48.5, 84);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Chapelle des Accoles', 'Dom. des Accoles', 'red', 'Vin de France (Rhône)', NULL, ARRAY['Syrah', 'Grenache']::text[], 2019, 53.5, 85);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Le Carafon', 'Dom. des Accoles', 'red', 'Vin de France (Rhône)', NULL, ARRAY['Grenache', 'Carignan']::text[], 2023, 49, 86);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Gryphe', 'Dom. des Accoles', 'red', 'Vin de France (Rhône)', NULL, ARRAY['Carignan']::text[], 2014, 74, 87);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Les Baux de Provence', 'Dom. des Terres Blanches', 'red', 'Provence', NULL, ARRAY['Syrah', 'Grenache Noir', 'Cabernet Sauvignon', 'Mourvèdre']::text[], 2019, 58, 88);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Fermentado en Barrica', 'Valenciso', 'white', 'Rioja', NULL, ARRAY['Viura', 'Garnacha Blanca']::text[], 2024, 49, 89);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Barba Blanco', 'Los Ángeles', 'white', 'Aragón', NULL, ARRAY['Macabeo (Viura)']::text[], 2024, 37.5, 90);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Manga del Brujo Selección Sobre Lías', 'El Escocés Volante', 'white', 'Aragón', NULL, ARRAY['Garnacha Blanca', 'Macabeo']::text[], 2024, 32, 91);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('L''Enclòs', 'Vi Fi de Masia', 'white', 'Penedès', NULL, ARRAY['Xarel·lo']::text[], 2022, 47, 92);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Zestos Blanco', 'Compañía de Vinos del Atlántico', 'white', 'Madrid', NULL, ARRAY['Malvar', 'Airén']::text[], 2023, 32.5, 93);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Locartas', 'Bodega Hermanos Mesa', 'white', 'Tenerife', NULL, ARRAY['Listán Blanco']::text[], 2023, 51, 94);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Jerónimo Listán Blanco', 'Victoria Torres Pecis', 'white', 'Canary Islands', 'La Palma', ARRAY['Listán Blanco']::text[], NULL, 85, 95);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Ijalba', 'Ijalba', 'red', 'Rioja', NULL, ARRAY['Graciano']::text[], 2022, 41.5, 96);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('La Antigua Clásico', 'Alberto Orte', 'red', 'Rioja', 'Crianza', ARRAY['Tempranillo']::text[], 2015, 39.5, 97);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Pintia', 'Vega Sicilia', 'red', 'Toro', NULL, ARRAY['Tinta de Toro']::text[], 2020, 119, 98);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Alión', 'Vega Sicilia', 'red', 'Ribera del Duero', NULL, ARRAY['Tempranillo']::text[], 2020, 130, 99);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Finca de Altura', 'Dominio Basconcillos', 'red', 'Ribera del Duero', NULL, ARRAY['Tempranillo']::text[], 2023, 42.9, 100);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Cruz Alta', 'Los Ángeles', 'red', 'Aragón', NULL, ARRAY['Garnacha']::text[], 2024, 37.5, 101);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Envínate Albahra', 'Envínate Albahra', 'red', 'Castilla La Mancha', 'Almansa', ARRAY['Tintorera', 'Moravia Agria']::text[], 2023, 42, 102);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Supernova Negre', 'Ca`n Verdura', 'red', 'Mallorca', NULL, ARRAY['Manto Negro']::text[], 2023, 51, 103);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Monastrell', 'Casa Castillo', 'red', 'Murcia', 'Jumilla', ARRAY['Monastrell (Mourvèdre)']::text[], 2022, 47, 104);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Listán Negro', 'Piedra Fluida', 'red', 'Tenerife', NULL, ARRAY['Listán Negro']::text[], 2020, 44, 105);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Melissae', 'Aphros', 'white', 'Vinho Verde', NULL, ARRAY['Loureiro']::text[], 2021, 57.5, 106);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Nativas', 'Ramilo', 'white', 'Lisboa', NULL, ARRAY['Vital', 'Arinto', 'Malvasia']::text[], 2023, 75.5, 107);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Caracol dos Profetas', 'António Maçanita + Nuno Faria', 'white', 'Madeira (dry)', NULL, ARRAY['Verdelho']::text[], 2023, 65, 108);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Menina d''Uva', 'Aline Domingues', 'red', 'Trás-os-Montes', NULL, ARRAY['Tinta Barroca', 'Touriga Nacional']::text[], NULL, 44.5, 109);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Os Canivéis', 'António Maçanita', 'red', 'Douro', NULL, ARRAY['Field Blend']::text[], 2021, 59, 110);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Cima Corgo', 'Maçanita', 'red', 'Douro', NULL, ARRAY['Touriga Nacional']::text[], 2022, 74, 111);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Vinhas Velhas Tinto', 'António Madeira', 'red', 'Dão', NULL, ARRAY['Field Blend (traditional Dão varieties)']::text[], 2020, 74.5, 112);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Reserva Tinto', 'Vinha do Mouro', 'red', 'Alentejo', NULL, ARRAY['Trincadeira', 'Aragonez', 'Alicante Bouschet', 'Cabernet Sauvignon']::text[], 2020, 41.5, 113);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Os Paulistas “Chão dos Eremitas”', 'Maçanita Fitapreta', 'red', 'Alentejo', NULL, ARRAY['Tinta Carvalha', 'Castelão', 'Alfrocheiro', 'Moreto', 'Trincadeira']::text[], 2021, 126, 114);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Tinta Negra dos Vilões', 'António Maçanita + Nuno Faria', 'red', 'Madeira', NULL, ARRAY['Tinta Negra']::text[], 2024, 61, 115);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Passerina', 'Lucrezia', 'white', 'Marche', NULL, ARRAY['Passerina']::text[], 2024, 38, 116);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Masso Catarratto', 'Feudo Montoni', 'white', 'Sicily', NULL, ARRAY['Catarratto']::text[], 2024, 44.7, 117);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Ramí', 'COS', 'white', 'Sicily', NULL, ARRAY['Inzolia', 'Grecanico']::text[], 2022, 54, 118);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Valpolicella', 'Marion', 'red', 'Veneto', NULL, ARRAY['Corvina', 'Corvinone', 'Rondinella', 'Oseleta']::text[], 2022, 49.5, 119);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Vigna Carzello Nebbiolo d’Alba', 'Edoardo Sobrino', 'red', 'Piedmont', NULL, ARRAY['Nebbiolo']::text[], 2013, 47, 120);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('CampoMoro', 'Accornero', 'red', 'Piedmont', NULL, ARRAY['Barbera']::text[], 2024, 38.5, 121);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Castelli Martinozzi', 'Castelli Martinozzi', 'red', 'Rosso Di Montalcino', NULL, ARRAY['Sangiovese']::text[], 2024, 36, 122);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Rosso di Montepulciano', 'Avignonesi', 'red', 'Tuscany', NULL, ARRAY['Sangiovese']::text[], 2022, 42.9, 123);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Le Bandite Chianti Classico Riserva', 'Lornano', 'red', 'Tuscany', NULL, ARRAY['Sangiovese']::text[], 2020, 52, 124);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Tignanello', 'Antinori', 'red', 'Tuscany', NULL, ARRAY['Sangiovese', 'Cabernet Sauvignon', 'Cabernet Franc']::text[], 2021, 195, 125);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Appassimento Carnalis', 'Idi Di Marzo', 'red', 'Puglia', 'Abruzzo', ARRAY['Montepulciano', 'Primitivo']::text[], 2022, 36, 126);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Nero Di Lupo', 'COS', 'red', 'Sicily', NULL, ARRAY['Nero d’Avola']::text[], 2023, 51, 127);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Tomi', 'Troupis Winery', 'white', 'Mantineia', NULL, ARRAY['Moschofilero']::text[], 2024, 43, 128);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Pyritis', 'Artemis Karamolegos Winery', 'white', 'Santorini', NULL, ARRAY['Assyrtiko']::text[], 2022, 110, 129);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Rethymno Young Vines', 'Iliana Malihin', 'white', 'Crete', NULL, ARRAY['Vidiano']::text[], 2021, 55, 130);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Amphora Acheron', 'Markogianni Winery', 'red', 'Peloponnese', NULL, ARRAY['Kolliniatiko']::text[], 2022, 45, 131);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Route 111', 'Troupis Winery', 'red', 'Peloponnese', NULL, ARRAY['Moschofilero']::text[], 2022, 45, 132);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Xinomavro', 'Oenops', 'red', 'Macedonia', NULL, ARRAY['Xinomavro']::text[], 2019, 52, 133);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Liatiko', 'Lyrarakis', 'red', 'Crete', NULL, ARRAY['Liatiko']::text[], 2023, 32, 134);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Sauvignon Blanc', 'MIRA', 'white', 'Czech Republic', 'Moravia', ARRAY['Sauvignon Blanc']::text[], 2024, 59, 135);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Sivi Pinot', 'Ferdinand Winery', 'white', 'Slovenia', 'Brda', ARRAY['Pinot Gris']::text[], 2024, 59, 136);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Vitovska', 'Marko Fon', 'white', 'Slovenia', 'Dežela Primorska', ARRAY['Vitovska']::text[], 2020, 78, 137);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Ribolla', 'Marjan Simčič', 'white', 'Slovenia', 'Brda', ARRAY['Ribolla Gialla']::text[], 2023, 74, 138);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Rebula', 'Ferdinand Matjaž Četrtič', 'white', 'Slovenia', 'Goriška Brda', ARRAY['Rebula (Ribolla Gialla)']::text[], 2023, 36, 139);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('“Akura” Dry White Qvevri', 'Winery PI', 'white', 'Georgia', 'Kakheti', ARRAY['Mtsvane', 'Rkatsiteli']::text[], 2022, 39, 140);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Tri Morave Crveno', 'Temet', 'red', 'Serbia', 'Jagodina', ARRAY['Prokupac', 'Vranac', 'Merlot']::text[], 2019, 38, 141);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Noir', 'Heaps Good Wine Company', 'red', 'Slovenia', 'Stajerska', ARRAY['Pinot Noir']::text[], 2019, 38, 142);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Jebatschin Red', 'Pasji Rep', 'red', 'Slovenia', 'Vipava Valley', ARRAY['Barbera', 'Merlot', 'Cabernet Sauvignon']::text[], 2023, 57, 143);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Barbera Moser', 'Pasji Rep', 'red', 'Slovenia', 'Vipava', ARRAY['Barbera']::text[], 2021, 79, 144);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Sensum', 'Borovitza', 'red', 'Bulgaria', 'Danubian Plain', ARRAY['Merlot', 'Cabernet Sauvignon']::text[], 2020, 34, 145);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Aladasturi', 'Labara', 'red', 'Georgia', 'Kakheti', ARRAY['Aladasturi']::text[], 2023, 41.5, 146);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Granítico Blanco', 'A los Viñateros Bravos', 'white', 'Chile', 'Itata Valley', ARRAY['Moscatel', 'Semillon']::text[], 2022, 39.5, 147);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Blanco De Itata', 'Masintin', 'white', 'Chile', 'Itata', ARRAY['Moscatel', 'Semillon']::text[], 2021, 53, 148);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Phoenix Ferment', 'Garage Winegrowers', 'white', 'Chile', 'Itata', ARRAY['País', 'Cariñena']::text[], 2022, 55.5, 149);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Cementerio', 'Longaví', 'white', 'Chile', 'Maule Valley', ARRAY['Chenin Blanc']::text[], 2023, 75.5, 150);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Chardonnay Unfiltered', 'Norman Hardie Winery', 'white', 'Canada', 'Ontario', ARRAY['Chardonnay']::text[], 2020, 87, 151);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Semillon', 'Idiom', 'white', 'South Africa', 'Stellenbosch', ARRAY['Semillon']::text[], 2023, 44, 152);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Vineyard Selection', 'Lothian', 'white', 'South Africa', 'Elgin', ARRAY['Chardonnay']::text[], 2022, 49, 153);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Cabernet Sauvignon', 'Girard', 'red', 'USA', 'Napa Valley, California', ARRAY['Cabernet Sauvignon']::text[], 2021, 67.5, 154);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Artistry', 'Girard', 'red', 'USA', 'Napa Valley, California', ARRAY['Cabernet Sauvignon', 'Merlot', 'Petit Verdot', 'Malbec']::text[], 2019, 119, 155);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Cape Blend', 'Idiom', 'red', 'South Africa', 'Stellenbosch', ARRAY['Pinotage', 'Cabernet Sauvignon', 'Merlot', 'Petit Verdot']::text[], 2019, 65, 156);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Rodanico Blend', 'Idiom', 'red', 'South Africa', 'Stellenbosch', ARRAY['Shiraz', 'Mourvèdre', 'Viognier']::text[], 2018, 65, 157);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Bordicon Blend', 'Idiom', 'red', 'South Africa', 'Stellenbosch', ARRAY['Cabernet Sauvignon', 'Cabernet Franc', 'Merlot', 'Petit Verdot', 'Malbec']::text[], 2018, 82.5, 158);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Pinot Noir', 'Lothian', 'red', 'South Africa', 'Elgin', ARRAY['Pinot Noir']::text[], 2020, 49.5, 159);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Pinot Noir', 'Smuggler’s Boot', 'red', 'South Africa', 'Elgin', ARRAY['Pinot Noir']::text[], 2023, 59, 160);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Granítico Cinsault', 'A los Viñateros Bravos', 'red', 'Chile', 'Itata Valley', ARRAY['Cinsault']::text[], 2022, 39.5, 161);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('215 BC Single Ferment', 'Garage Winegrowers', 'red', 'Chile', 'Itata', ARRAY['País']::text[], 2022, 55.5, 162);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Cinsault', 'Masintin', 'red', 'Chile', 'Itata', ARRAY['Cinsault']::text[], 2021, 58, 163);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('República', 'Longaví', 'red', 'Chile', 'Maule Valley', ARRAY['Carignan', 'Grenache', 'Mourvèdre']::text[], 2024, 44, 164);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('Reforma', 'Longaví', 'red', 'Chile', 'Maule Valley', ARRAY['Grenache']::text[], 2023, 75.5, 165);
insert into wines (name, producer, colour, country, region, grapes, vintage, bottle, position) values ('GLUP! Carignan', 'Longaví', 'red', 'Chile', 'Maule Valley', ARRAY['Carignan']::text[], 2022, 34, 166);

-- the bar list: 79 pours across 14 sections
insert into drink_sections (id, title, is_wine, position) values ('sparkling', 'Sparkling', true, 0);
insert into drink_sections (id, title, is_wine, position) values ('rose', 'Rosé', true, 1);
insert into drink_sections (id, title, is_wine, position) values ('orange', 'Orange', true, 2);
insert into drink_sections (id, title, is_wine, position) values ('white', 'White', true, 3);
insert into drink_sections (id, title, is_wine, position) values ('chilled-red', 'Chilled red', true, 4);
insert into drink_sections (id, title, is_wine, position) values ('red', 'Red', true, 5);
insert into drink_sections (id, title, is_wine, position) values ('beer', 'Beers', false, 6);
insert into drink_sections (id, title, is_wine, position) values ('cocktails', 'Cocktails', false, 7);
insert into drink_sections (id, title, is_wine, position) values ('skinny', 'Skinny list', false, 8);
insert into drink_sections (id, title, is_wine, position) values ('sober', 'Sober list', false, 9);
insert into drink_sections (id, title, is_wine, position) values ('gin', 'Gin o''clock', false, 10);
insert into drink_sections (id, title, is_wine, position) values ('digestives', 'Digestives', false, 11);
insert into drink_sections (id, title, is_wine, position) values ('spirits', 'Spirits', false, 12);
insert into drink_sections (id, title, is_wine, position) values ('soft', 'Soft drinks', false, 13);

insert into drinks (section_id, name, note, price, sold_out, position) values ('sparkling', 'Mont Marçal - Cava Reserva Brut', 'Spain · Macabeo, Parellada, Xarel·lo', 7.5, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('sparkling', 'Ta-nnin Label Brut', 'Champagne, France · Pinot Noir, Chardonnay', 12.9, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('sparkling', 'Gabernik 23 - PetNat Rosé', 'Štajerska, Slovenia', 9.4, false, 2);
insert into drinks (section_id, name, note, price, sold_out, position) values ('rose', 'Belles du Sud - L''Îlot', 'Sables de Camargue, France · Cinsault, Grenache', 7.1, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('rose', '2024 António Maçanita - Rosé Vulcânico', 'Azores, Portugal', 9.7, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('orange', 'Altolandon - Mil Historias', 'Manchuela, Spain · Macabeu, Moscatel', 7.9, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('orange', 'Ta-Orange - Nikolaevo', 'Thracian Valley, Bulgaria · the house orange', 11.9, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('white', 'Tokaj-Hétszőlő - Dry Furmint', 'Tokaj, Hungary', 8.5, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('white', 'Battenfeld-Spanier - Grüner Sylvaner Reserve Trocken', 'Rheinhessen, Germany', 10.9, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('white', 'Idiom - Viognier', 'Stellenbosch, South Africa', 9.5, false, 2);
insert into drinks (section_id, name, note, price, sold_out, position) values ('white', 'Vincent Prunier - Bourgogne Côte d''Or Chardonnay', 'Burgundy, France', 12.5, false, 3);
insert into drinks (section_id, name, note, price, sold_out, position) values ('white', 'Philipp Kuhn - vom Kalkmergel Chardonnay', 'Pfalz, Germany', 11, false, 4);
insert into drinks (section_id, name, note, price, sold_out, position) values ('white', 'Vin de Liège - Les Éolides', 'Wallonia, Belgium · organic field blend', 9.5, false, 5);
insert into drinks (section_id, name, note, price, sold_out, position) values ('white', 'Zestos Blanco', 'Vinos de Madrid, Spain · Malvar, Airén', 7.5, false, 6);
insert into drinks (section_id, name, note, price, sold_out, position) values ('white', 'Vignoble du Rêveur - Vigne en Rose', 'Alsace, France · Gewurztraminer, Riesling', 10.9, false, 7);
insert into drinks (section_id, name, note, price, sold_out, position) values ('chilled-red', 'Niepoort - Nat''Cool', 'Dão, Portugal · light, juicy, low intervention', 7.5, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('chilled-red', 'Klopfer - Lemberger Trocken', 'Württemberg, Germany', 7.5, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('red', 'Dom. Machard de Gramont - Pinot Noir', 'Burgundy, France', 11, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('red', 'Idiom - Zinfandel', 'Stellenbosch, South Africa', 9.5, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('red', 'Lothian - Horny Owl Pinot Noir', 'Elgin, South Africa', 8.5, false, 2);
insert into drinks (section_id, name, note, price, sold_out, position) values ('red', 'Ferdinand Matjaž Četrtič - Cabernet Sauvignon', 'Goriška Brda, Slovenia', 8.5, false, 3);
insert into drinks (section_id, name, note, price, sold_out, position) values ('red', 'Les Éclats de Branas Grand Poujeaux', 'Moulis-en-Médoc, Bordeaux, France', 7.7, false, 4);
insert into drinks (section_id, name, note, price, sold_out, position) values ('red', 'Domaine de la Marfée - Les Gamines', 'Languedoc, France', 8.8, false, 5);
insert into drinks (section_id, name, note, price, sold_out, position) values ('beer', 'IJwit', 'Amsterdam brewery', 5.9, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('beer', 'Tank 7', NULL, 5.5, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('beer', 'Duvel', NULL, 5.5, false, 2);
insert into drinks (section_id, name, note, price, sold_out, position) values ('beer', 'Tripel d''Anvers', NULL, 5.5, false, 3);
insert into drinks (section_id, name, note, price, sold_out, position) values ('beer', 'Bavik Super Pils', NULL, 3.2, false, 4);
insert into drinks (section_id, name, note, price, sold_out, position) values ('beer', 'Duchesse de Bourgogne', 'West-Flemish red brown ale', 6.5, false, 5);
insert into drinks (section_id, name, note, price, sold_out, position) values ('beer', 'Tipsy Silver', '0% · Belgian alcohol-free blond', 5.5, false, 6);
insert into drinks (section_id, name, note, price, sold_out, position) values ('beer', 'Unplugged - ''t Verzet', '0% · alcohol-free hazy IPA', 5.5, false, 7);
insert into drinks (section_id, name, note, price, sold_out, position) values ('cocktails', 'Aperol Spritz', NULL, 9.7, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('cocktails', 'Campari Spritz', NULL, 11, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('cocktails', 'Verveine Sparkler', 'Verveine brut syrup, sparkling wine, sparkling water', 10.5, false, 2);
insert into drinks (section_id, name, note, price, sold_out, position) values ('cocktails', 'Negroni', NULL, 13.5, false, 3);
insert into drinks (section_id, name, note, price, sold_out, position) values ('cocktails', 'Moscow Mule', NULL, 13.5, false, 4);
insert into drinks (section_id, name, note, price, sold_out, position) values ('cocktails', 'Dark & Stormy', NULL, 13.5, false, 5);
insert into drinks (section_id, name, note, price, sold_out, position) values ('cocktails', 'Porn Star Martini', NULL, 13.5, false, 6);
insert into drinks (section_id, name, note, price, sold_out, position) values ('cocktails', 'Espresso Martini', NULL, 13.5, false, 7);
insert into drinks (section_id, name, note, price, sold_out, position) values ('cocktails', 'Lazy Red Cheeks', 'Vodka, raspberry, violet, lime, cane sugar', 13.5, false, 8);
insert into drinks (section_id, name, note, price, sold_out, position) values ('cocktails', 'Lilo Negroni', 'Grilled pineapple tequila, Amaro Montenegro, limoncello', 14, false, 9);
insert into drinks (section_id, name, note, price, sold_out, position) values ('cocktails', 'Lilo Mai Tai', 'Mandarinetto, amaretto, gin, lemon', 14, false, 10);
insert into drinks (section_id, name, note, price, sold_out, position) values ('skinny', 'Skinny Bitch', 'Vodka, lime juice, sparkling water', 12.5, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('skinny', 'Skinny Mule', 'Vodka, ginger & lemon kombucha', 13.5, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('skinny', 'Skinny Stormy', 'Dark rum, ginger & lemon kombucha', 13.5, false, 2);
insert into drinks (section_id, name, note, price, sold_out, position) values ('sober', 'Sober Dark & Stormy', '0% rum, lime, ginger beer', 11, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('sober', 'Copperhead 0.0 Gin & Tonic', NULL, 11, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('sober', 'Sober Lazy Red Cheeks', 'Raspberry, violet, lime, cane sugar, sparkling water', 11, false, 2);
insert into drinks (section_id, name, note, price, sold_out, position) values ('sober', 'Paloma', 'Blood orange, grapefruit, chili, sparkling water', 11, false, 3);
insert into drinks (section_id, name, note, price, sold_out, position) values ('sober', 'Spicy Mule', 'Ginger, lime', 11, false, 4);
insert into drinks (section_id, name, note, price, sold_out, position) values ('sober', 'Crodino N.A. with tonic', NULL, 9.5, false, 5);
insert into drinks (section_id, name, note, price, sold_out, position) values ('sober', 'Crodino N.A.', NULL, 5.7, false, 6);
insert into drinks (section_id, name, note, price, sold_out, position) values ('gin', 'The Perfect Bulldog', NULL, 13, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('gin', 'Marula Pomegranate', NULL, 13.5, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('gin', 'Gin Mare', NULL, 15, false, 2);
insert into drinks (section_id, name, note, price, sold_out, position) values ('gin', 'Copperhead', NULL, 15, false, 3);
insert into drinks (section_id, name, note, price, sold_out, position) values ('gin', 'Antverpia', NULL, 15, false, 4);
insert into drinks (section_id, name, note, price, sold_out, position) values ('digestives', 'Andresen 10 Year Old White Port', NULL, 8.5, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('digestives', 'Amaretto', NULL, 7.5, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('digestives', 'Limoncello', 'On the rocks', 7, false, 2);
insert into drinks (section_id, name, note, price, sold_out, position) values ('digestives', 'Limoncello', 'Shot', 5, false, 3);
insert into drinks (section_id, name, note, price, sold_out, position) values ('digestives', 'Maderista - Madeira Reserva Dry', NULL, 0, true, 4);
insert into drinks (section_id, name, note, price, sold_out, position) values ('spirits', 'Belvedere Vodka', NULL, 11, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('spirits', 'Mezcal Del Maguey Vida', NULL, 11, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('spirits', 'Talisker 10Y', NULL, 11, false, 2);
insert into drinks (section_id, name, note, price, sold_out, position) values ('spirits', 'Wild Turkey 101', NULL, 9, false, 3);
insert into drinks (section_id, name, note, price, sold_out, position) values ('spirits', 'Bushmills', NULL, 9, false, 4);
insert into drinks (section_id, name, note, price, sold_out, position) values ('spirits', 'Campari on the rocks', NULL, 7.5, false, 5);
insert into drinks (section_id, name, note, price, sold_out, position) values ('soft', 'Chaudfontaine still', '250ml', 3.17, false, 0);
insert into drinks (section_id, name, note, price, sold_out, position) values ('soft', 'Chaudfontaine sparkling', '250ml', 3.2, false, 1);
insert into drinks (section_id, name, note, price, sold_out, position) values ('soft', 'Chaudfontaine still', '500ml', 6.2, false, 2);
insert into drinks (section_id, name, note, price, sold_out, position) values ('soft', 'Chaudfontaine sparkling', '500ml', 6.2, false, 3);
insert into drinks (section_id, name, note, price, sold_out, position) values ('soft', 'Coca-Cola', NULL, 3.7, false, 4);
insert into drinks (section_id, name, note, price, sold_out, position) values ('soft', 'Coca-Cola Zero', NULL, 3.7, false, 5);
insert into drinks (section_id, name, note, price, sold_out, position) values ('soft', 'Sprite', NULL, 3.7, false, 6);
insert into drinks (section_id, name, note, price, sold_out, position) values ('soft', 'Ice tea', NULL, 3.7, false, 7);
insert into drinks (section_id, name, note, price, sold_out, position) values ('soft', 'Fever-Tree Mediterranean tonic', NULL, 4.2, false, 8);
insert into drinks (section_id, name, note, price, sold_out, position) values ('soft', 'Fever-Tree ginger beer', NULL, 4.2, false, 9);
insert into drinks (section_id, name, note, price, sold_out, position) values ('soft', 'JARR ginger kombucha', NULL, 5.9, false, 10);

commit;
