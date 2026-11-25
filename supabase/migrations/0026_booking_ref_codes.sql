-- Reservation and cancellation reference codes.
--
-- Two short, human codes: a reservation number a guest gets when their table is
-- confirmed, and a cancellation number when it is cancelled. Backed by
-- sequences, so each is unique without a lookup and short enough to read down a
-- phone.
--
-- The reservation code is a column default, so every way a booking can arrive —
-- the website, a staff phone booking, a hand-written row — gets one for free.
-- The cancellation code is a trigger, assigned the moment a booking first
-- becomes cancelled, whichever route did it: the guest's own link or the staff
-- board both run an UPDATE, and this catches both without either having to
-- remember to.
--
-- Idempotent: sequences and columns are guarded, the backfill only touches rows
-- with no code yet, and the trigger and functions are drop-and-recreate.

create sequence if not exists booking_ref_seq start 1000;
create sequence if not exists booking_cancel_seq start 1;

alter table bookings
  add column if not exists ref_code text
    default 'TN-' || to_char(nextval('booking_ref_seq'), 'FM00000');
alter table bookings add column if not exists cancel_code text;

-- Any row that predates the column (or was added before the default existed).
update bookings
set ref_code = 'TN-' || to_char(nextval('booking_ref_seq'), 'FM00000')
where ref_code is null;

-- A cancellation code, assigned once, the first time a booking becomes
-- cancelled — not re-minted if it is reinstated and cancelled again, so the
-- number a guest was told stays the number on the row.
create or replace function set_cancel_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'cancelled'
     and old.status is distinct from 'cancelled'
     and new.cancel_code is null then
    new.cancel_code := 'TN-C-' || to_char(nextval('booking_cancel_seq'), 'FM00000');
  end if;
  return new;
end;
$$;

drop trigger if exists booking_cancel_code on bookings;
create trigger booking_cancel_code
  before update on bookings
  for each row execute function set_cancel_code();

-- The reservation code for one manage token.
--
-- For the confirmation email on a website booking that confirmed itself: the
-- anon key cannot read the row back — row-level security forbids listing the
-- guest book — and the code is not a secret, so a narrow security-definer read
-- of just this one column is the safe way to fetch it. Unlike booking_by_token
-- it returns nothing that identifies the guest.
create or replace function booking_ref_by_token(token uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select ref_code from bookings where manage_token = token;
$$;

revoke execute on function booking_ref_by_token(uuid) from public;
grant execute on function booking_ref_by_token(uuid) to anon, authenticated;
