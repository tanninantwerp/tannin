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
