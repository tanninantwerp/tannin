import { getPathname } from '@/i18n/navigation';
import { routing, type Locale, type StaticRoute } from '@/i18n/routing';
import { LOCALE_TAG } from '@/i18n/tags';

/**
 * Canonical and hreflang for one page.
 *
 * Worth doing by hand rather than hardcoding strings, because the Dutch routes
 * are translated: `/wine` is `/nl/wijnkaart`, not `/nl/wine`. Asking
 * `getPathname` means the tags can never drift from the routing table - rename
 * a route there and every canonical follows.
 */
export function alternatesFor(href: StaticRoute, locale: Locale) {
  const languages = Object.fromEntries(
    routing.locales.map((l) => [LOCALE_TAG[l], getPathname({ href, locale: l })]),
  );

  return {
    canonical: getPathname({ href, locale }),
    languages: {
      ...languages,
      'x-default': getPathname({ href, locale: routing.defaultLocale }),
    },
  };
}
