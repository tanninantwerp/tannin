import type { Locale } from './routing';

/**
 * The full language tag behind each URL segment.
 *
 * The routing locale is deliberately short - `/nl`, not `/nl-BE` - but nothing
 * else wants the short form. `en` on its own formats dates the American way
 * ("August 4, 2026"), and the bar is in Antwerp, so everything that touches
 * `Intl`, `<html lang>` or an OpenGraph tag goes through here instead.
 */
export const LOCALE_TAG: Record<Locale, string> = {
  en: 'en-GB',
  nl: 'nl-BE',
  fr: 'fr-BE',
};
