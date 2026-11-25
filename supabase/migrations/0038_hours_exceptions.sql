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
