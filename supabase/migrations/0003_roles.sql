-- Role-based permissions.
--
-- 0001 gave every staff member identical power: is_staff() guarded every write.
-- That is wrong for a room with a floor team — someone covering a shift should
-- be able to mark a bottle sold out without also being able to delete the wine
-- list or add themselves a colleague.
--
-- Three roles, and the split follows what people actually do:
--
--   floor   — mark things sold out, and put them back. Nothing else.
--   manager — everything about the menus, the wine and the bookings.
--   owner   — the above, plus adding and removing staff.
--
-- All of it is enforced here rather than in the admin UI. A hidden button is
-- not a permission; this is.

/*
 * Skipped once 0012 has run.
 *
 * setup.sql re-applies every migration in order, and 0012 removes `role` and
 * these three functions for good. A plain `create or replace ... language sql`
 * checks its own body at creation time, so on a second paste this would fail
 * on a column that no longer exists — taking the whole file down with it. The
 * guard makes the historical step a no-op instead, which is what it is.
 */
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'role'
  ) then
    execute $roles$
      create or replace function staff_role_of(uid uuid default auth.uid())
      returns staff_role
      language sql
      security definer
      set search_path = public
      stable
      as $fn$
        select role from staff where user_id = uid;
      $fn$;

      create or replace function is_manager()
      returns boolean
      language sql
      security definer
      set search_path = public
      stable
      as $fn$
        select coalesce(staff_role_of() in ('owner', 'manager'), false);
      $fn$;

      create or replace function is_owner()
      returns boolean
      language sql
      security definer
      set search_path = public
      stable
      as $fn$
        select coalesce(staff_role_of() = 'owner', false);
      $fn$;
    $roles$;
  end if;
end $$;

/*
 * Also skipped once 0012 has run: every policy below names is_manager() or
 * is_owner(), which 0012 drops along with the column they read. 0012 creates
 * the permission-based replacements for all of them, so on a re-paste there
 * is nothing here worth doing and a great deal worth not failing on.
 */
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'role'
  ) then
    execute $roles$
      -- ── replace the blanket staff policies with role-aware ones ──────────────────
      
      drop policy if exists "staff write drinks"         on drinks;
      drop policy if exists "staff write drink sections" on drink_sections;
      drop policy if exists "staff write menu items"     on menu_items;
      drop policy if exists "staff write menu sections"  on menu_sections;
      drop policy if exists "staff write wines"          on wines;
      drop policy if exists "staff write blackouts"      on blackouts;
      drop policy if exists "staff write products"       on products;
      
      -- Anyone on the staff may edit an existing row: this is what makes the
      -- sold-out toggle work for the floor team mid-service.
      drop policy if exists "staff update drinks" on drinks;
      create policy "staff update drinks" on drinks     for update using (is_staff()) with check (is_staff());
      drop policy if exists "staff update menu items" on menu_items;
      create policy "staff update menu items" on menu_items for update using (is_staff()) with check (is_staff());
      
      -- Adding and removing things from the list is a manager's job.
      drop policy if exists "managers insert drinks" on drinks;
      create policy "managers insert drinks" on drinks for insert with check (is_manager());
      drop policy if exists "managers delete drinks" on drinks;
      create policy "managers delete drinks" on drinks for delete using (is_manager());
      
      drop policy if exists "managers insert menu items" on menu_items;
      create policy "managers insert menu items" on menu_items for insert with check (is_manager());
      drop policy if exists "managers delete menu items" on menu_items;
      create policy "managers delete menu items" on menu_items for delete using (is_manager());
      
      drop policy if exists "managers write drink sections" on drink_sections;
      create policy "managers write drink sections" on drink_sections for all
        using (is_manager()) with check (is_manager());
      drop policy if exists "managers write menu sections" on menu_sections;
      create policy "managers write menu sections" on menu_sections for all
        using (is_manager()) with check (is_manager());
      drop policy if exists "managers write wines" on wines;
      create policy "managers write wines" on wines for all
        using (is_manager()) with check (is_manager());
      drop policy if exists "managers write blackouts" on blackouts;
      create policy "managers write blackouts" on blackouts for all
        using (is_manager()) with check (is_manager());
      drop policy if exists "managers write products" on products;
      create policy "managers write products" on products for all
        using (is_manager()) with check (is_manager());
      
      -- Bookings: the floor needs to seat and cancel, so update stays open to staff,
      -- but clearing the record is a manager's call.
      drop policy if exists "staff delete bookings" on bookings;
      drop policy if exists "managers delete bookings" on bookings;
      create policy "managers delete bookings" on bookings for delete using (is_manager());
      
      -- ── the staff list itself ────────────────────────────────────────────────────
      -- Only owners. Without this, any staff member could promote themselves, which
      -- makes every rule above decorative.
      
      drop policy if exists "owners insert staff" on staff;
      create policy "owners insert staff" on staff for insert with check (is_owner());
      drop policy if exists "owners update staff" on staff;
      create policy "owners update staff" on staff for update using (is_owner()) with check (is_owner());
      drop policy if exists "owners delete staff" on staff;
      create policy "owners delete staff" on staff for delete using (is_owner());
      
      -- An owner cannot demote or delete themselves and leave the room without one.
      create or replace function guard_last_owner()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      declare
        remaining int;
      begin
        if (tg_op = 'DELETE' and old.role = 'owner')
           or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
          select count(*) into remaining from staff where role = 'owner' and user_id <> old.user_id;
          if remaining = 0 then
            raise exception 'There has to be at least one owner.';
          end if;
        end if;
        return coalesce(new, old);
      end;
      $fn$;
      
      drop trigger if exists staff_guard_last_owner on staff;
      create trigger staff_guard_last_owner
        before update or delete on staff
        for each row execute function guard_last_owner();
      
    $roles$;
  end if;
end $$;
