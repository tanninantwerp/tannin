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
