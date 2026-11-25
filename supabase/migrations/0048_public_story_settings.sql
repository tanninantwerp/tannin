-- Let the public site read the current Instagram story.
--
-- The bug: `app_settings` was created in 0045 with exactly one policy,
-- "marketing read write app_settings", gated on `has_perm('marketing')`. The
-- website reads with the anon key, which has no permissions at all, so its
-- select returned zero rows rather than an error - and `fetchCurrentStory` maps
-- "no story_image_url" to "no story". Staff could publish a story, see it saved
-- in admin, and watch nothing appear on the home page, with nothing logged
-- anywhere. The feature had never worked in public.
--
-- The fix is deliberately narrow. `app_settings` is also where 0045 intends to
-- keep the Instagram access token and its connection metadata, so a blanket
-- `using (true)` here would publish a long-lived credential to anyone who
-- guessed the table name. This grants read on the four story keys and nothing
-- else, listed explicitly rather than by a `story_%` prefix: a prefix would
-- silently expose a future key like `story_upload_token`, and being forced to
-- edit this list when the story gains a field is the point, not an oversight.
--
-- The keys are exactly the ones `fetchCurrentStory` asks for. Permissive
-- policies are OR'd, so marketing staff keep full read and write through the
-- existing policy; this only widens select, and only for these rows.

drop policy if exists "app_settings public read story" on app_settings;
create policy "app_settings public read story" on app_settings
  for select using (
    key in ('story_image_url', 'story_href', 'story_account', 'story_expires_at')
  );
