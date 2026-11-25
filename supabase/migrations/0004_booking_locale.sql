-- Which language the guest booked in.
--
-- Without this, the confirmation a Flemish guest gets when staff press
-- "Confirm" three hours later would be in English, because by then the only
-- thing left of their visit is a database row. The website knows the language
-- at the moment of booking; this is where it puts it.
--
-- Defaults to 'en' so every row written before this migration stays valid.

alter table bookings
  add column if not exists locale text not null default 'en'
  check (locale in ('en', 'nl'));

-- The public insert policy has to allow the new column through. Dropping and
-- recreating is the only way to amend a `with check` clause.
drop policy if exists "anyone may request a table" on bookings;

drop policy if exists "anyone may request a table" on bookings;
create policy "anyone may request a table" on bookings for insert with check (
  date >= current_date
  and date <= current_date + interval '365 days'
  and party_size between 1 and 8
  and locale in ('en', 'nl')
);
