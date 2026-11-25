import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reads and writes for the site's own texts and the pages staff add
 * (Admin > Texts and Admin > Pages). Every text is `{ en, nl, fr }`; a missing
 * language falls back to English on the site.
 */

export type L10nText = { en?: string; nl?: string; fr?: string };

export interface SitePage {
  id: string;
  slug: string;
  title: L10nText;
  body: L10nText;
  imageUrl: string | null;
  seoTitle: L10nText;
  seoDescription: L10nText;
  published: boolean;
  inFooter: boolean;
  position: number;
  updatedAt: string;
}

type PageRow = {
  id: string;
  slug: string;
  title: L10nText | null;
  body: L10nText | null;
  image_url: string | null;
  seo_title: L10nText | null;
  seo_description: L10nText | null;
  published: boolean;
  in_footer: boolean;
  position: number;
  updated_at: string;
};

function toPage(r: PageRow): SitePage {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title ?? {},
    body: r.body ?? {},
    imageUrl: r.image_url,
    seoTitle: r.seo_title ?? {},
    seoDescription: r.seo_description ?? {},
    published: r.published,
    inFooter: r.in_footer,
    position: r.position,
    updatedAt: r.updated_at,
  };
}

/** Every text edit, keyed by message path ("about.heading"). */
export async function fetchSiteTexts(db: SupabaseClient): Promise<Record<string, L10nText>> {
  const { data, error } = await db.from('site_texts').select('key, value');
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r: { key: string; value: L10nText }) => [r.key, r.value ?? {}]));
}

export async function saveSiteTexts(db: SupabaseClient, texts: Record<string, L10nText>): Promise<void> {
  const now = new Date().toISOString();
  const rows = Object.entries(texts).map(([key, value]) => ({ key, value, updated_at: now }));
  if (!rows.length) return;
  const { error } = await db.from('site_texts').upsert(rows);
  if (error) throw error;
}

/** Back to the wording in the code, in all three languages. */
export async function deleteSiteText(db: SupabaseClient, key: string): Promise<void> {
  const { error } = await db.from('site_texts').delete().eq('key', key);
  if (error) throw error;
}

/** Published pages for the site (footer, sitemap). Row-level security hides drafts from visitors anyway. */
export async function fetchPublishedPages(db: SupabaseClient): Promise<SitePage[]> {
  const { data, error } = await db.from('pages').select('*').eq('published', true).order('position').order('slug');
  if (error) throw error;
  return ((data ?? []) as PageRow[]).map(toPage);
}

export async function fetchPageBySlug(db: SupabaseClient, slug: string): Promise<SitePage | null> {
  const { data, error } = await db.from('pages').select('*').eq('slug', slug).eq('published', true).maybeSingle();
  if (error) throw error;
  return data ? toPage(data as PageRow) : null;
}

/** Drafts included, for the admin. */
export async function fetchAllPages(db: SupabaseClient): Promise<SitePage[]> {
  const { data, error } = await db.from('pages').select('*').order('position').order('slug');
  if (error) throw error;
  return ((data ?? []) as PageRow[]).map(toPage);
}

export type SitePageInput = Omit<SitePage, 'id' | 'position' | 'updatedAt'>;

/** New page at the end of the list. Returns its id. */
export async function createPage(db: SupabaseClient, page: SitePageInput): Promise<string> {
  const { count } = await db.from('pages').select('id', { count: 'exact', head: true });
  const { data, error } = await db
    .from('pages')
    .insert({ ...toRow(page), position: count ?? 0 })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updatePage(db: SupabaseClient, id: string, page: SitePageInput): Promise<void> {
  const { error } = await db
    .from('pages')
    .update({ ...toRow(page), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deletePage(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('pages').delete().eq('id', id);
  if (error) throw error;
}

/** Writes the order shown in the admin (0, 1, 2...). */
export async function reorderPages(db: SupabaseClient, ids: string[]): Promise<void> {
  const results = await Promise.all(ids.map((id, position) => db.from('pages').update({ position }).eq('id', id)));
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

function toRow(p: SitePageInput) {
  return {
    slug: p.slug,
    title: p.title,
    body: p.body,
    image_url: p.imageUrl,
    seo_title: p.seoTitle,
    seo_description: p.seoDescription,
    published: p.published,
    in_footer: p.inFooter,
  };
}
