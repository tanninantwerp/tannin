-- Gift vouchers: raise the ceiling from 1000 to 3000 euros (Sacha, 2026-11-07).
-- The website takes 20 to 3000; the bar can still issue from 5.
alter table gift_vouchers drop constraint if exists gift_vouchers_amount_cents_check;
alter table gift_vouchers add constraint gift_vouchers_amount_cents_check
  check (amount_cents between 500 and 300000);
