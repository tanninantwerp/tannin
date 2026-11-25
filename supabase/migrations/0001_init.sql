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
