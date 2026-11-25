-- Social posts — the "From the street" Instagram tiles on the homepage.
--
-- Staff with the marketing permission curate which posts appear: upload the
-- image to the media bucket (0043), paste the Instagram link, set a caption.
-- The public site shows only published posts; staff see drafts in the admin.
-- Order is manually arranged, same as events.

create table if not exists social_posts (
  id         uuid        primary key default gen_random_uuid(),
  image_url  text        not null,
  label      text        not null,
  title      text        not null,
  href       text        not null,
  position   integer     not null default 0,
  published  boolean     not null default true,
  created_at timestamptz not null default now()
);

create index if not exists social_posts_position_idx on social_posts (position);

alter table social_posts enable row level security;

-- Published posts are public; staff see drafts too.
drop policy if exists "social_posts public read" on social_posts;
create policy "social_posts public read" on social_posts
  for select using (published = true or is_staff());

-- Only the marketing permission writes.
drop policy if exists "marketing write social_posts" on social_posts;
create policy "marketing write social_posts" on social_posts
  for all using (has_perm('marketing')) with check (has_perm('marketing'));
