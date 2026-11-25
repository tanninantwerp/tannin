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
