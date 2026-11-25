import type { MetadataRoute } from 'next';
import { getPathname } from '@/i18n/navigation';
import { routing, type StaticRoute } from '@/i18n/routing';
import { LOCALE_TAG } from '@/i18n/tags';
import { IS_LIVE_SITE, SITE_URL } from '@/lib/site';

/**
 * Every public page, in both languages.
 *
 * Splitting the site into pages was worth doing because each one can rank for
 * its own query - but only once they are found, and a wine list nobody has
 * crawled ranks for nothing. This is the file that tells Google the other pages
 * exist rather than waiting for it to follow links.
 *
 * Built from the routing table, so a page added there appears here without
 * anybody remembering to. Which is the point: a sitemap maintained by hand is a
 * sitemap that silently goes stale.
 */

/** `/booking/[token]` is deliberately absent - it is private and noindex. */
const PUBLIC_ROUTES: StaticRoute[] = ['/', '/wine', '/drinks', '/menu', '/events', '/cellar', '/about', '/visit', '/gift'];

/** Roughly how often each page's content actually moves. */
const CHANGES: Partial<Record<StaticRoute, MetadataRoute.Sitemap[number]['changeFrequency']>> = {
  '/drinks': 'weekly', // the bar list moves week to week
  '/wine': 'weekly',
  '/menu': 'monthly',
  '/events': 'weekly', // what's-on changes as nights are added
  '/cellar': 'weekly', // winemaker nights and the shop list move
  '/': 'monthly',
  '/about': 'yearly',
  '/visit': 'yearly',
  '/gift': 'yearly',
};

const PRIORITY: Partial<Record<StaticRoute, number>> = {
  '/': 1,
  '/wine': 0.9,
  '/drinks': 0.9,
  '/menu': 0.8,
};

export default function sitemap(): MetadataRoute.Sitemap {
  // Empty on the demo and on previews. robots.txt already refuses those, and
  // publishing a map of pages nobody may crawl only contradicts it.
  if (!IS_LIVE_SITE) return [];

  const lastModified = new Date();

  return PUBLIC_ROUTES.flatMap((href) =>
    routing.locales.map((locale) => ({
      url: `${SITE_URL}${getPathname({ href, locale })}`,
      lastModified,
      changeFrequency: CHANGES[href] ?? 'monthly',
      priority: PRIORITY[href] ?? 0.6,
      // Tells Google these URLs are the same page in different languages,
      // rather than two pages competing with each other.
      alternates: {
        languages: Object.fromEntries(
          routing.locales.map((l) => [
            LOCALE_TAG[l],
            `${SITE_URL}${getPathname({ href, locale: l })}`,
          ]),
        ),
      },
    })),
  );
}
