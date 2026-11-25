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
