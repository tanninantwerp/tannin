import { getLocale } from 'next-intl/server';
import { unstable_cache } from 'next/cache';
import { fetchPublishedPages, type SitePage } from '@tannin/supabase';
import { routing } from '@/i18n/routing';
import { serverDb } from '@/lib/server-db';
import { CONTENT_TAG } from '@/lib/site-texts';

/** Published pages from Admin > Pages, cached like the texts. Empty if the read fails. */
export const publishedPages = unstable_cache(
  async (): Promise<SitePage[]> => {
    try {
      return await fetchPublishedPages(serverDb());
    } catch {
      return [];
    }
  },
  ['published-pages'],
  { revalidate: 60, tags: [CONTENT_TAG] },
);

/** Links in the footer to the pages staff switched "In the footer" on for. */
export async function FooterPages() {
  const [locale, pages] = await Promise.all([getLocale(), publishedPages()]);
  const shown = pages.filter((p) => p.inFooter);
  return shown.map((p) => {
    const title = p.title[locale as 'en'] || p.title.en || p.slug;
    return (
      <a
        key={p.id}
        href={locale === routing.defaultLocale ? `/${p.slug}` : `/${locale}/${p.slug}`}
        className="hover:text-[var(--color-green-pale)]"
      >
        {title}
      </a>
    );
  });
}
