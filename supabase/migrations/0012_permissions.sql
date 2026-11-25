-- Permissions, ticked one at a time. No more role names.
--
-- 0003 sold three bundles: floor, manager, owner. Bundles are a guess about
-- which powers travel together, and the guess was wrong the first time somebody
-- needed to let a person fix the wine list without also handing them the
-- bookings. Sacha has asked for the powers themselves, as checkboxes.
--
-- Six of them, and each one is a real thing the admin does:
--
--   sold_out  mark a bottle or a dish gone, and put it back
--   menu      add and remove food, and the sections it sits in
--   drinks    add and remove wines and the bar list
--   bookings  see the diary, seat people, cancel
--   tables    the floor plan, the terrace switch, how long a table is held
--   people    add and remove staff, set passwords, tick these boxes
--
-- Still enforced here rather than in the admin. Every rule below is a policy in
-- Postgres, so a hidden button is not what stops anybody — the database is.
--
-- Roles are gone completely at the end of this file: the column, the type and
-- the three functions that read it.

/*
 * The list lives in one place. A permission that is not in it cannot be
 * written, so a typo in the admin ('bookins') fails loudly at the database
 * rather than becoming a power nobody holds and no screen grants.
 */
alter table staff add column if not exists permissions text[] not null default '{}';

alter table staff drop constraint if exists staff_permissions_check;
alter table staff add constraint staff_permissions_check check (
  permissions <@ array['sold_out', 'menu', 'drinks', 'bookings', 'tables', 'people']::text[]
);

/*
 * Carry the old roles across, once. Guarded on the column still existing
 * because setup.sql re-runs every migration in order and the drop at the foot
 * of this file has already happened by the second pass — without this, a
 * re-paste would fail on a column that is no longer there.
 *
 * floor keeps bookings: 0001 let anybody on the staff list read and update the
 * diary, and quietly taking that away during a rename would be a change
 * nobody asked for.
 */
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'role'
  ) then
    execute $mig$
      update staff set permissions =
        case role::text
          when 'owner'   then array['sold_out','menu','drinks','bookings','tables','people']
          when 'manager' then array['sold_out','menu','drinks','bookings','tables']
          else                array['sold_out','bookings']
        end
      where permissions = '{}';
    $mig$;
  end if;
end $$;

/** Does the signed-in person hold this permission? */
create or replace function has_perm(p text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p = any(permissions) from staff where user_id = auth.uid()),
    false
  );
$$;

-- ── the policies, one permission at a time ───────────────────────────────────

-- Sold-out is an update on an existing row, and nothing else.
drop policy if exists "staff update drinks" on drinks;
drop policy if exists "sold_out updates drinks" on drinks;
create policy "sold_out updates drinks" on drinks for update
  using (has_perm('sold_out') or has_perm('drinks'))
  with check (has_perm('sold_out') or has_perm('drinks'));

drop policy if exists "staff update menu items" on menu_items;
drop policy if exists "sold_out updates menu items" on menu_items;
create policy "sold_out updates menu items" on menu_items for update
  using (has_perm('sold_out') or has_perm('menu'))
  with check (has_perm('sold_out') or has_perm('menu'));

-- Drinks: the bar list and the wines.
drop policy if exists "managers insert drinks" on drinks;
drop policy if exists "managers delete drinks" on drinks;
drop policy if exists "drinks insert" on drinks;
create policy "drinks insert" on drinks for insert with check (has_perm('drinks'));
drop policy if exists "drinks delete" on drinks;
create policy "drinks delete" on drinks for delete using (has_perm('drinks'));

drop policy if exists "managers write drink sections" on drink_sections;
drop policy if exists "drinks write sections" on drink_sections;
create policy "drinks write sections" on drink_sections for all
  using (has_perm('drinks')) with check (has_perm('drinks'));

drop policy if exists "managers write wines" on wines;
drop policy if exists "drinks write wines" on wines;
create policy "drinks write wines" on wines for all
  using (has_perm('drinks')) with check (has_perm('drinks'));

-- Menu: the food.
drop policy if exists "managers insert menu items" on menu_items;
drop policy if exists "managers delete menu items" on menu_items;
drop policy if exists "menu insert" on menu_items;
create policy "menu insert" on menu_items for insert with check (has_perm('menu'));
drop policy if exists "menu delete" on menu_items;
create policy "menu delete" on menu_items for delete using (has_perm('menu'));

drop policy if exists "managers write menu sections" on menu_sections;
drop policy if exists "menu write sections" on menu_sections;
create policy "menu write sections" on menu_sections for all
  using (has_perm('menu')) with check (has_perm('menu'));

-- Stock lives with the drinks list; it is the same job.
drop policy if exists "managers write products" on products;
drop policy if exists "drinks write products" on products;
create policy "drinks write products" on products for all
  using (has_perm('drinks')) with check (has_perm('drinks'));

-- Bookings: the diary.
drop policy if exists "staff read bookings" on bookings;
drop policy if exists "staff update bookings" on bookings;
drop policy if exists "staff delete bookings" on bookings;
drop policy if exists "managers delete bookings" on bookings;
drop policy if exists "bookings read" on bookings;
create policy "bookings read" on bookings for select using (has_perm('bookings'));
drop policy if exists "bookings update" on bookings;
create policy "bookings update" on bookings for update
  using (has_perm('bookings')) with check (has_perm('bookings'));
drop policy if exists "bookings delete" on bookings;
create policy "bookings delete" on bookings for delete using (has_perm('bookings'));

-- Tables: the floor plan, the terrace switch, the turn length, the closures.
drop policy if exists "staff write tables" on dining_tables;
drop policy if exists "tables write" on dining_tables;
create policy "tables write" on dining_tables for all
  using (has_perm('tables')) with check (has_perm('tables'));

drop policy if exists "staff write settings" on booking_settings;
drop policy if exists "tables write settings" on booking_settings;
create policy "tables write settings" on booking_settings for all
  using (has_perm('tables')) with check (has_perm('tables'));

drop policy if exists "managers write blackouts" on blackouts;
drop policy if exists "tables write blackouts" on blackouts;
create policy "tables write blackouts" on blackouts for all
  using (has_perm('tables')) with check (has_perm('tables'));

-- People: the staff list itself. Without this being its own permission,
-- anybody could tick their own boxes and every rule above is decorative.
drop policy if exists "owners insert staff" on staff;
drop policy if exists "owners update staff" on staff;
drop policy if exists "owners delete staff" on staff;
drop policy if exists "people insert staff" on staff;
create policy "people insert staff" on staff for insert with check (has_perm('people'));
drop policy if exists "people update staff" on staff;
create policy "people update staff" on staff for update
  using (has_perm('people')) with check (has_perm('people'));
drop policy if exists "people delete staff" on staff;
create policy "people delete staff" on staff for delete using (has_perm('people'));

/*
 * The room cannot be left with nobody who can add anybody.
 *
 * Same guard as 0003's last-owner rule, rewritten for the permission: it is
 * now possible to remove 'people' from yourself by unticking a box, which is a
 * quieter way to lock everyone out than deleting an account.
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
  if (tg_op = 'DELETE' and 'people' = any(old.permissions))
     or (tg_op = 'UPDATE' and 'people' = any(old.permissions)
         and not ('people' = any(new.permissions))) then
    select count(*) into remaining
    from staff
    where 'people' = any(permissions) and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'Somebody has to be able to manage people.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists staff_guard_last_owner on staff;
drop trigger if exists staff_guard_last_people on staff;
create trigger staff_guard_last_people
  before update or delete on staff
  for each row execute function guard_last_people();

-- ── roles, gone ──────────────────────────────────────────────────────────────

drop function if exists is_owner();
drop function if exists is_manager();
drop function if exists staff_role_of(uuid);
drop trigger if exists staff_guard_last_owner on staff;
drop function if exists guard_last_owner();

alter table staff drop column if exists role;
drop type if exists staff_role;
