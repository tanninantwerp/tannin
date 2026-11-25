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
