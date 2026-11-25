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
