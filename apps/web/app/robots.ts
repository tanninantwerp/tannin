import type { MetadataRoute } from 'next';
import { IS_LIVE_SITE, SITE_URL } from '@/lib/site';

/**
 * Crawlers are welcome everywhere except two places - once there is a site for
 * them to crawl.
 *
 * Until `ta-nnin.be` is attached, this is a demo on a Vercel URL, and a demo
 * must not be indexed: it would put a half-finished version of the bar into
 * search results, competing with the real site when that arrives. So anything
 * that is not the live domain refuses everything.
 *
 * `/booking/` and `/reservering/` are a guest's own booking, reached by a token
 * in a link mailed to them. Those URLs should never be crawled, indexed or
 * turned up in a search result - the page carries a name and a date, and the
 * token in the address is the only thing standing between a stranger and
 * cancelling somebody's table. The pages are already noindex; this stops a
 * crawler fetching them at all.
 *
 * `/api/` is not content and has nothing to say to a search engine.
 */
export default function robots(): MetadataRoute.Robots {
  // No sitemap and no host either - pointing a crawler at a map of a site it
  // has just been told to stay out of is a mixed message worth not sending.
  if (!IS_LIVE_SITE) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/booking/', '/nl/reservering/', '/fr/reservation/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
