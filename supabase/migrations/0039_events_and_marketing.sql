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
