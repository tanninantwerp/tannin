-- Turning somebody off without deleting them.
--
-- Removing a person destroys their login and their row. That is right for
-- somebody who has left, and much too much for somebody on holiday, off sick,
-- or a seasonal hand who will be back in April — and the alternative people
-- reach for in that moment is sharing a login, which is worse than either.
--
-- Off means off everywhere, not just hidden on the People page: `is_staff()`
-- and `has_perm()` both stop saying yes, so every policy that names them stops
-- letting the person through. The login still exists and the password still
-- works, so switching them back on is one tap rather than a new account.

alter table staff add column if not exists active boolean not null default true;

/*
 * Rewritten rather than left alone: these two are what every policy in 0003
 * and 0012 actually calls, so changing them here is what makes the switch real
 * instead of cosmetic. Somebody switched off keeps their row and their
 * password and loses every permission until they are switched back on.
 */
create or replace function is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from staff where user_id = auth.uid() and active);
$$;

create or replace function has_perm(p text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p = any(permissions) and active from staff where user_id = auth.uid()),
    false
  );
$$;

/*
 * The last-people guard has to count this too. Switching off the only person
 * who can manage people locks the room out exactly as thoroughly as deleting
 * them, and it is a smaller, easier action to take by accident.
 */
create or replace function guard_last_people()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
begin
  if (tg_op = 'DELETE' and 'people' = any(old.permissions) and old.active)
     or (tg_op = 'UPDATE' and 'people' = any(old.permissions) and old.active
         and not ('people' = any(new.permissions) and new.active)) then
    select count(*) into remaining
    from staff
    where 'people' = any(permissions) and active and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'Somebody has to be able to manage people.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
