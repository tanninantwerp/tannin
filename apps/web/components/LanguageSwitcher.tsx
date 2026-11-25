'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';

const TONE = {
  light: {
    dim: 'text-[var(--text-muted)] hover:text-[var(--text)]',
    lit: 'text-[var(--text)]',
    rule: 'text-[var(--text-muted)]/50',
  },
  dark: {
    dim: 'text-[var(--color-paper)]/45 hover:text-[var(--color-paper)]',
    lit: 'text-[var(--color-paper)]',
    rule: 'text-[var(--color-paper)]/30',
  },
} as const;

/**
 * English lives at `/` and `/drinks`, Dutch at `/nl` and `/nl/drinks`, so the
 * other language is always the same path with the prefix added or removed.
 * Written out by hand rather than through the localised `Link`, which insists
 * on `/en/...` when a locale is passed explicitly and so costs a redirect on
 * every switch back to English.
 */
function hrefFor(locale: Locale, pathname: string) {
  const path = pathname === '/' ? '' : pathname;
  return locale === routing.defaultLocale ? path || '/' : `/${locale}${path}`;
}

export function LanguageSwitcher({ tone = 'light' }: { tone?: keyof typeof TONE }) {
  const active = useLocale();
  // next-intl's version of the hook, which reports the path without the prefix.
  const pathname = usePathname();
  const t = useTranslations('language');
  const style = TONE[tone];

  return (
    <nav
      aria-label={t('label')}
      className="flex shrink-0 items-center gap-2 text-[0.68rem] uppercase tracking-[0.2em]"
    >
      {routing.locales.map((locale, i) => (
        <span key={locale} className="flex items-center gap-2">
          {i > 0 && (
            <span aria-hidden="true" className={style.rule}>
              /
            </span>
          )}
          {/*
            A plain anchor on purpose: switching language swaps the whole
            document, so there is nothing for a client-side transition to reuse.
          */}
          <a
            href={hrefFor(locale, pathname)}
            hrefLang={locale}
            aria-current={locale === active ? 'page' : undefined}
            className={locale === active ? style.lit : style.dim}
          >
            <span className="sr-only">{t(`${locale}Full`)}</span>
            <span aria-hidden="true">{t(locale)}</span>
          </a>
        </span>
      ))}
    </nav>
  );
}
