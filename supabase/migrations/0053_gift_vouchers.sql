-- Gift vouchers, sold online and over the bar, redeemed at the bar.
--
--   gift_vouchers             one row per voucher: value, what is left on it,
--                             who it is for, and how it was paid for
--   gift_voucher_redemptions  every time some of it is spent, and by whom
--
-- A voucher can be spent over several visits, so `balance_cents` goes down and
-- the redemptions are the ledger behind it. Nobody writes either table
-- directly: staff go through the functions below, which lock the row and check
-- the balance in one step, so two people redeeming the same card at the same
-- moment cannot both spend the last 20 euros.
--
-- Online sales arrive through Stripe. The website stores a `pending` row before
-- sending the buyer to pay, and only once Stripe confirms the payment does
-- `activate_gift_voucher` give it a code. A pending row is not a voucher: it
-- has no code, so there is nothing to redeem.

-- 1. A `vouchers` permission, for whoever works the till.
alter table staff drop constraint if exists staff_permissions_check;
alter table staff add constraint staff_permissions_check check (
  permissions <@ array['sold_out', 'menu', 'drinks', 'bookings', 'tables', 'people', 'marketing', 'vouchers']::text[]
);

-- Whoever manages people gets it once, so the owner can use it immediately.
update staff
  set permissions = array_append(permissions, 'vouchers')
  where 'people' = any(permissions) and not ('vouchers' = any(permissions));

-- 2. The vouchers.
create table if not exists gift_vouchers (
  id                    uuid primary key default gen_random_uuid(),
  -- Five digits from 10000, null until paid for.
  code                  text unique,
  -- 5 to 1000 euros: wider than the website offers (20 minimum), so a bar sale
  -- is never refused for being an unusual amount.
  amount_cents          int not null check (amount_cents between 500 and 100000),
  balance_cents         int not null,
  status                text not null default 'pending' check (status in ('pending', 'active', 'void')),
  source                text not null check (source in ('online', 'bar')),
  recipient_name        text check (char_length(recipient_name) <= 60),
  from_name             text check (char_length(from_name) <= 60),
  note                  text check (char_length(note) <= 160),
  buyer_email           text check (char_length(buyer_email) <= 254),
  -- Set when the buyer chose to send the voucher straight to the recipient.
  recipient_email       text check (char_length(recipient_email) <= 254),
  recipient_emailed_at  timestamptz,
  locale                text not null default 'en' check (locale in ('en', 'nl')),
  valid_until           date,
  stripe_session_id     text unique,
  stripe_payment_intent text,
  emailed_at            timestamptz,
  issued_by             uuid references auth.users (id) on delete set null,
  void_reason           text check (char_length(void_reason) <= 160),
  created_at            timestamptz not null default now(),
  activated_at          timestamptz,
  voided_at             timestamptz,
  constraint gift_vouchers_balance check (balance_cents between 0 and amount_cents),
  constraint gift_vouchers_active_complete check (status <> 'active' or (code is not null and valid_until is not null))
);

create index if not exists gift_vouchers_created_idx on gift_vouchers (created_at desc);
create index if not exists gift_vouchers_payment_idx on gift_vouchers (stripe_payment_intent);

create table if not exists gift_voucher_redemptions (
  id           uuid primary key default gen_random_uuid(),
  voucher_id   uuid not null references gift_vouchers (id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  staff_id     uuid references auth.users (id) on delete set null,
  note         text check (char_length(note) <= 160),
  created_at   timestamptz not null default now()
);

create index if not exists gift_voucher_redemptions_voucher_idx on gift_voucher_redemptions (voucher_id, created_at desc);

-- Read-only to staff with the permission; the public key sees nothing at all.
-- No write policies, on purpose: every change goes through a function below.
alter table gift_vouchers enable row level security;
alter table gift_voucher_redemptions enable row level security;

drop policy if exists "gift_vouchers staff read" on gift_vouchers;
create policy "gift_vouchers staff read" on gift_vouchers
  for select using (has_perm('vouchers'));

drop policy if exists "gift_voucher_redemptions staff read" on gift_voucher_redemptions;
create policy "gift_voucher_redemptions staff read" on gift_voucher_redemptions
  for select using (has_perm('vouchers'));

-- 3. Codes.
--
-- Five digits, counting up from 10000, so a voucher is short to read out or
-- type at the bar. Codes are not guessable by design: redeeming one needs
-- staff with the `vouchers` permission, and nothing on the public site can look
-- a code up. The sequence is the only source of numbers, so no two vouchers
-- can share one.
create sequence if not exists gift_voucher_number_seq start with 10000 minvalue 10000;

create or replace function gift_voucher_code()
returns text
language sql
volatile
security definer
set search_path = public
as $$ select nextval('gift_voucher_number_seq')::text $$;

revoke execute on function gift_voucher_code() from public;

-- Today in Antwerp, so a voucher does not expire an hour early in winter.
create or replace function gift_voucher_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Europe/Brussels')::date $$;

-- Whatever staff typed, as five digits. Mirrors normaliseVoucherCode.
create or replace function gift_voucher_normalise(in_code text)
returns text
language plpgsql
immutable
as $$
declare
  s text := upper(regexp_replace(coalesce(in_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  s := regexp_replace(s, '^TN', '');
  if s !~ '^[0-9]{5}$' then return null; end if;
  return s;
end;
$$;

-- 4. Paid for online: called by the website, with the service key, once Stripe
-- says the money is in. Safe to call twice - the webhook and the thank-you page
-- both call it and either may arrive first - and the second call just returns
-- the voucher the first one made.
create or replace function activate_gift_voucher(in_id uuid, in_payment_intent text)
returns gift_vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  v gift_vouchers;
begin
  select * into v from gift_vouchers where id = in_id for update;
  if not found then
    raise exception 'No such voucher.' using errcode = 'TN010';
  end if;
  if v.status <> 'pending' then
    return v;
  end if;

  update gift_vouchers set
    status = 'active',
    code = gift_voucher_code(),
    valid_until = (gift_voucher_today() + interval '12 months')::date,
    stripe_payment_intent = coalesce(in_payment_intent, stripe_payment_intent),
    activated_at = now()
  where id = in_id
  returning * into v;

  return v;
end;
$$;

revoke execute on function activate_gift_voucher(uuid, text) from public;
grant execute on function activate_gift_voucher(uuid, text) to service_role;

-- 5. Sold over the bar: staff take the money at the till and the admin prints
-- the card, so the paper vouchers live in the same register as the online ones.
create or replace function issue_gift_voucher(
  in_amount_cents int,
  in_recipient text,
  in_from text,
  in_note text
)
returns gift_vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  v gift_vouchers;
begin
  if not has_perm('vouchers') then
    raise exception 'Staff only.' using errcode = '42501';
  end if;

  insert into gift_vouchers (
    code, amount_cents, balance_cents, status, source,
    recipient_name, from_name, note, valid_until, issued_by, activated_at
  ) values (
    gift_voucher_code(), in_amount_cents, in_amount_cents, 'active', 'bar',
    nullif(trim(in_recipient), ''), nullif(trim(in_from), ''), nullif(trim(in_note), ''),
    (gift_voucher_today() + interval '12 months')::date, auth.uid(), now()
  )
  returning * into v;

  return v;
end;
$$;

revoke execute on function issue_gift_voucher(int, text, text, text) from public;
grant execute on function issue_gift_voucher(int, text, text, text) to authenticated;

-- 6. Spending it. Each refusal has its own SQLSTATE so the admin can say
-- exactly what is wrong without matching on English:
--   TN010 no such code     TN011 voided      TN012 expired
--   TN013 not an amount    TN014 more than is left on it
create or replace function redeem_gift_voucher(in_code text, in_amount_cents int, in_note text)
returns gift_vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  v gift_vouchers;
begin
  if not has_perm('vouchers') then
    raise exception 'Staff only.' using errcode = '42501';
  end if;

  select * into v from gift_vouchers
    where code = gift_voucher_normalise(in_code) and status <> 'pending'
    for update;

  if not found then
    raise exception 'No voucher with that code.' using errcode = 'TN010';
  end if;
  if v.status = 'void' then
    raise exception 'This voucher has been cancelled.' using errcode = 'TN011';
  end if;
  if v.valid_until < gift_voucher_today() then
    raise exception 'This voucher expired on %.', to_char(v.valid_until, 'DD/MM/YYYY') using errcode = 'TN012';
  end if;
  if in_amount_cents is null or in_amount_cents <= 0 then
    raise exception 'Enter the amount to take off.' using errcode = 'TN013';
  end if;
  if in_amount_cents > v.balance_cents then
    raise exception 'Only % cents left on this voucher.', v.balance_cents using errcode = 'TN014';
  end if;

  insert into gift_voucher_redemptions (voucher_id, amount_cents, staff_id, note)
    values (v.id, in_amount_cents, auth.uid(), nullif(trim(in_note), ''));

  update gift_vouchers set balance_cents = balance_cents - in_amount_cents
    where id = v.id
    returning * into v;

  return v;
end;
$$;

revoke execute on function redeem_gift_voucher(text, int, text) from public;
grant execute on function redeem_gift_voucher(text, int, text) to authenticated;

-- 7. Cancelling one: a refund, a mistake at the till, a lost card reissued.
-- The row stays, so the register still adds up.
create or replace function void_gift_voucher(in_id uuid, in_reason text)
returns gift_vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  v gift_vouchers;
begin
  if not has_perm('vouchers') then
    raise exception 'Staff only.' using errcode = '42501';
  end if;

  update gift_vouchers set
    status = 'void',
    voided_at = now(),
    void_reason = nullif(trim(in_reason), '')
  where id = in_id and status = 'active'
  returning * into v;

  if not found then
    raise exception 'No active voucher to cancel.' using errcode = 'TN010';
  end if;

  return v;
end;
$$;

revoke execute on function void_gift_voucher(uuid, text) from public;
grant execute on function void_gift_voucher(uuid, text) to authenticated;
