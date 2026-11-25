-- Instagram sync support.
--
-- Adds instagram_id to social_posts so the sync can upsert without duplicates,
-- and app_settings for storing the access token and connection metadata.
-- Posts without an instagram_id are manual uploads — the sync never touches them.

alter table social_posts
  add column if not exists instagram_id text;

create unique index if not exists social_posts_instagram_id_idx
  on social_posts (instagram_id)
  where instagram_id is not null;

-- App-level key/value store: Instagram token, last-sync time, etc.
create table if not exists app_settings (
  key        text        primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

-- Only marketing staff can read or write settings.
drop policy if exists "marketing read write app_settings" on app_settings;
create policy "marketing read write app_settings" on app_settings
  for all using (has_perm('marketing')) with check (has_perm('marketing'));
