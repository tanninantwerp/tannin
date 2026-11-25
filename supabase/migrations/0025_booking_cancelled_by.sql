-- Telling a guest's own cancellation apart from a staff one.
--
-- Both are the same thing in the row — `status = 'cancelled'` — and so are
-- indistinguishable in a Realtime payload. But the admin only wants to be
-- *alerted* about the ones it did not do itself: a table freeing up because a
-- guest cancelled online is news worth a toast; a staff member declining a
-- request from the board is not, they are the one who just did it.
--
-- A nullable marker, stamped at the moment of cancellation. The guest's only
-- route, `cancel_booking_by_token`, stamps 'guest'; the staff path
-- (`setBookingStatus`) stamps 'staff' or clears it. The admin's live notifier
-- reacts to 'guest' alone.
--
-- Idempotent: the column add is guarded, the constraint is dropped and
-- recreated, and the function is a create-or-replace.

alter table bookings add column if not exists cancelled_by text;

alter table bookings drop constraint if exists bookings_cancelled_by_check;
alter table bookings
  add constraint bookings_cancelled_by_check
  check (cancelled_by is null or cancelled_by in ('guest', 'staff'));

-- Cancelling, now recording that it was the guest who did it. Otherwise
-- unchanged from 0005: same token-only authorisation, same refusal to reopen a
-- seated or past booking, same three-way return so the caller can tell "you
-- have cancelled it" from "it was already cancelled" from "no such booking".
create or replace function cancel_booking_by_token(token uuid)
returns booking_status
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  present booking_status;
  when_   date;
begin
  select status, date into present, when_
  from bookings
  where manage_token = token;

  -- No such token. Null rather than an error: the caller should not be able to
  -- tell a wrong token from a deleted booking.
  if present is null then
    return null;
  end if;

  -- Already resolved one way or another. Cancelling something the guest was
  -- seated at would rewrite history.
  if present in ('cancelled', 'seated', 'no_show') then
    return present;
  end if;

  -- Nothing to free up in the past, and letting it through would let someone
  -- with an old link quietly edit last month's covers.
  if when_ < current_date then
    return present;
  end if;

  update bookings
  set status = 'cancelled', cancelled_by = 'guest'
  where manage_token = token;
  return 'cancelled';
end;
$$;
