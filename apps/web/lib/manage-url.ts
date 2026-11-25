import { getPathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { SITE_URL } from './site';

/**
 * The guest's own manage link, in their language.
 *
 * Built through `getPathname` rather than by hand so it follows the routing
 * table - a Dutch guest gets `/nl/reservering/…`, and if that word ever
 * changes, so does every link minted afterwards.
 */
export function manageUrlFor(token: string, locale: Locale): string {
  const path = getPathname({
    href: { pathname: '/booking/[token]', params: { token } },
    locale,
  });
  return `${SITE_URL}${path}`;
}
