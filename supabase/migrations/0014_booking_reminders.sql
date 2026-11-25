-- Reminder emails: the day before, and the morning of.
--
-- Nothing sent one before now — a request came in, staff confirmed or declined
-- it, and the guest heard nothing else until they either showed up or forgot.
-- Only two more emails, and only for bookings that had time to be forgotten in
-- the first place: one made three hours before the sitting does not need a
-- reminder on top of the confirmation that just landed.
--
-- Two columns rather than one "reminders sent" flag, because the two reminders
-- are independent events that can each fail or succeed on their own — a failed
-- day-before send should not block the same-day one twelve hours later.

alter table bookings add column if not exists reminded_day_before_at timestamptz;
alter table bookings add column if not exists reminded_same_day_at   timestamptz;
