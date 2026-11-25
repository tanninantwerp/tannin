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
