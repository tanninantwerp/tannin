-- Site texts and pages, edited in the admin (Admin > Texts, Admin > Pages).
--
-- Brought over from the 58diamonds admin. Every text is a jsonb object
-- { "en": ..., "nl": ..., "fr": ... }; a language left out falls back to the
-- wording in the code (packages/content/messages), then to English.
--
-- Public read, so the website (anon key) can lay the edits over its own
-- texts; only the marketing permission writes, like events and social.

-- 1. Edits to the site's own texts, keyed by the message path ("about.heading").
--    No row means the wording in the code shows. Deleting a row puts it back.
create table if not exists site_texts (
  key        text        primary key check (key ~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$'),
  value      jsonb       not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  updated_at timestamptz not null default now()
);

alter table site_texts enable row level security;

drop policy if exists "site texts public read" on site_texts;
create policy "site texts public read" on site_texts
  for select using (true);

drop policy if exists "marketing write site texts" on site_texts;
create policy "marketing write site texts" on site_texts
  for all using (has_perm('marketing')) with check (has_perm('marketing'));

-- 2. Pages staff add themselves (a private-events page, a jobs page...),
--    at ta-nnin.be/<slug>, /nl/<slug> and /fr/<slug>. `body` is simple
--    Markdown per language. A new page starts as a draft.
create table if not exists pages (
  id               uuid        primary key default gen_random_uuid(),
  slug             text        not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            jsonb       not null default '{}'::jsonb,
  body             jsonb       not null default '{}'::jsonb,
  image_url        text,
  seo_title        jsonb       not null default '{}'::jsonb,
  seo_description  jsonb       not null default '{}'::jsonb,
  published        boolean     not null default false,
  in_footer        boolean     not null default false,
  position         int         not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists pages_position_idx on pages (position);

alter table pages enable row level security;

-- Published pages are public; staff see drafts too.
drop policy if exists "pages public read" on pages;
create policy "pages public read" on pages
  for select using (published = true or is_staff());

drop policy if exists "marketing write pages" on pages;
create policy "marketing write pages" on pages
  for all using (has_perm('marketing')) with check (has_perm('marketing'));
