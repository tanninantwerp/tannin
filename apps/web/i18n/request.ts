import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { applyOverrides, DEFAULT_MESSAGES } from '@tannin/content';
import { siteTextEdits } from '@/lib/site-texts';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    // Pinned, so a date rendered at build time in one timezone cannot come out
    // a day off for a reader in another.
    timeZone: 'Europe/Brussels',
    // The wording in packages/content/messages, with the edits from Admin > Texts on top.
    messages: applyOverrides(DEFAULT_MESSAGES[locale], await siteTextEdits(), locale),
  };
});
