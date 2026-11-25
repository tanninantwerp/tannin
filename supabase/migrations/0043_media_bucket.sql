-- Public bucket for admin-uploaded images.
--
-- The events editor (and later menu/wine) had a plain URL field, so a photo
-- meant hotlinking or a developer dropping a file in the repo and deploying.
-- With this bucket, whoever holds `marketing` picks a file in the browser and
-- the admin writes to Supabase Storage, storing the returned public URL in
-- `events.image_url`.
--
-- Public read; only the marketing permission writes. Menu/wine will reuse the
-- same bucket when their editors get an image field — one bucket keeps the
-- policy surface small.
--
-- PGlite has no `storage` schema, so the migration test skips this whole block.
-- The real Supabase runs it; the tests still verify every prior migration.

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $mig$
      insert into storage.buckets (id, name, public)
      values ('media', 'media', true)
      on conflict (id) do nothing
    $mig$;

    execute $mig$ drop policy if exists "media public read" on storage.objects $mig$;
    execute $mig$
      create policy "media public read" on storage.objects
        for select using (bucket_id = 'media')
    $mig$;

    execute $mig$ drop policy if exists "marketing writes media" on storage.objects $mig$;
    execute $mig$
      create policy "marketing writes media" on storage.objects
        for insert to authenticated
        with check (bucket_id = 'media' and has_perm('marketing'))
    $mig$;

    execute $mig$ drop policy if exists "marketing updates media" on storage.objects $mig$;
    execute $mig$
      create policy "marketing updates media" on storage.objects
        for update to authenticated
        using (bucket_id = 'media' and has_perm('marketing'))
        with check (bucket_id = 'media' and has_perm('marketing'))
    $mig$;

    execute $mig$ drop policy if exists "marketing deletes media" on storage.objects $mig$;
    execute $mig$
      create policy "marketing deletes media" on storage.objects
        for delete to authenticated
        using (bucket_id = 'media' and has_perm('marketing'))
    $mig$;
  end if;
end $$;
