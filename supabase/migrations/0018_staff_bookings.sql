-- Staff can take a booking over the phone.
--
-- `book_table` already lets anyone authenticated call it — the public site's
-- anon key and a signed-in staff member hit the exact same function. The one
-- thing standing in the way is email: `guest_email` is `not null`, which is
-- right for a guest filling in a web form and wrong for someone who was only
-- ever asked for a name and a number over the phone.
--
-- The fix is narrow: the column becomes nullable, and the function only
-- insists on an email from callers who are not staff. A phone booking with no
-- address just never gets a confirmation email — the person on the phone
-- already knows the outcome, because they were told it.

alter table bookings alter column guest_email drop not null;

create or replace function book_table(
  on_date   date,
  at_time   time,
  party     int,
  in_name   text,
  in_email  text,
  in_phone  text default null,
  in_note   text default null,
  in_lang   text default 'en',
  in_client text default null,
  in_area   text default null
)
returns table (id uuid, manage_token uuid, status booking_status)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  chosen       uuid;
  new_status   booking_status;
  lang         text := case when in_lang in ('en', 'nl') then in_lang else 'en' end;
  wanted_area  text := case when in_area in ('inside', 'terrace', 'bar') then in_area else null end;
  keys         text[];
  seen         int;
  staff_caller boolean := is_staff();
begin
  if party < 1 or party > 8 then
    raise exception 'party size out of range';
  end if;
  if on_date < current_date or on_date > current_date + 365 then
    raise exception 'date out of range';
  end if;
  if in_name is null or btrim(in_name) = '' then
    raise exception 'name is required';
  end if;
  -- A guest booking online has no one to tell them the outcome, so an address
  -- is how they find out. Staff taking a call already are that person.
  if not staff_caller and (in_email is null or btrim(in_email) = '') then
    raise exception 'name and email are required';
  end if;

  if char_length(btrim(in_name)) > 80 or char_length(coalesce(btrim(in_email), '')) > 254
     or char_length(coalesce(btrim(in_phone), '')) > 32
     or char_length(coalesce(btrim(in_note), '')) > 500 then
    raise exception 'field too long';
  end if;

  if exists (
    select 1 from blackouts bl
    where bl.date = on_date
      and (bl."from" is null or (at_time >= bl."from" and at_time < bl."to"))
  ) then
    raise exception 'closed at that time';
  end if;

  -- Staff calling this from the admin are not the thing throttling exists to
  -- stop — skip the guest-abuse counter entirely rather than let a busy phone
  -- line trip a limit meant for the anonymous web form.
  if not staff_caller then
    delete from booking_throttle where at < now() - throttle_window();

    keys := array_remove(
      array[
        'email:' || lower(btrim(in_email)),
        'ip:' || nullif(btrim(coalesce(in_client, '')), '')
      ]::text[],
      null::text
    );

    select count(*) into seen
    from booking_throttle t
    where t.key = any (keys);

    if seen >= throttle_max() then
      raise exception 'too many bookings from this source'
        using errcode = 'TN001';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(on_date::text));

  select t.id into chosen
  from dining_tables t
  where t.active
    and t.seats >= party
    and t.min_seats <= party
    and (wanted_area is null or t.area = wanted_area)
    and not exists (
      select 1 from area_closures ac
      where ac.area = t.area and on_date between ac.from_date and ac.to_date
    )
    and not exists (
      select 1
      from bookings b
      where b.table_id = t.id
        and b.date = on_date
        and b.status in ('pending', 'confirmed', 'seated')
        and (on_date + b.time, on_date + b.time + table_turn())
            overlaps
            (on_date + at_time, on_date + at_time + table_turn())
    )
  order by t.seats asc, t.position asc
  limit 1;

  new_status := case when chosen is null then 'pending' else 'confirmed' end::booking_status;

  if not staff_caller then
    insert into booking_throttle (key)
    select unnest(keys);
  end if;

  return query
  insert into bookings (
    date, time, party_size, guest_name, guest_email,
    guest_phone, notes, locale, status, table_id, requested_area
  )
  values (
    on_date, at_time, party, btrim(in_name), nullif(btrim(coalesce(in_email, '')), ''),
    nullif(btrim(coalesce(in_phone, '')), ''),
    nullif(btrim(coalesce(in_note, '')), ''),
    lang, new_status, chosen, wanted_area
  )
  returning bookings.id, bookings.manage_token, bookings.status;
end;
$$;
