import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    // Pinned, so a date rendered at build time in one timezone cannot come out
    // a day off for a reader in another.
    timeZone: 'Europe/Brussels',
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
