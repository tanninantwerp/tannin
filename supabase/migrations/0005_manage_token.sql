-- Guest self-service, without an account.
--
-- Every booking already carries a `manage_token` for this. The problem it poses
-- is that row-level security has nothing to match on: the guest is anonymous,
-- so there is no `auth.uid()` to compare against, and a policy broad enough to
-- let them read their own row would let them read everyone's.
--
-- Two security-definer functions instead. They run as the owner, so they see
-- past RLS, but each one only ever touches the single row whose token was
-- passed in, and neither returns the token, the email or the phone number. The
-- token is a v4 uuid — 122 bits of entropy — so guessing one is not a thing
-- that happens.

-- What the manage page shows. Deliberately not `select *`: the guest already
-- knows their own email and there is no reason for this to hand it back, which
-- would turn a leaked link into a way to read contact details.
create or replace function booking_by_token(token uuid)
returns table (
  date       date,
  "time"     time,
  party_size int,
  guest_name text,
  status     booking_status,
  locale     text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.date, b.time, b.party_size, b.guest_name, b.status, b.locale
  from bookings b
  where b.manage_token = token;
$$;

-- Cancelling. Returns the status the booking ended up in, so the caller can
-- tell "you have cancelled it" from "it was already cancelled" from "no such
-- booking" without a second round trip.
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

  update bookings set status = 'cancelled' where manage_token = token;
  return 'cancelled';
end;
$$;

-- Postgres grants execute to PUBLIC by default. Take that back and be explicit
-- about who may call these.
revoke execute on function booking_by_token(uuid) from public;
revoke execute on function cancel_booking_by_token(uuid) from public;

grant execute on function booking_by_token(uuid) to anon, authenticated;
grant execute on function cancel_booking_by_token(uuid) to anon, authenticated;
