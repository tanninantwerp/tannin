import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LAST_CALL_KITCHEN, VENUE } from '@tannin/core';
import { fetchBarList, fetchBarListUpdatedAt } from '@tannin/supabase';
import { DrinksMenu } from '@/components/DrinksMenu';
import { SiteNav } from '@/components/SiteNav';
import { routing, type Locale } from '@/i18n/routing';
import { LOCALE_TAG } from '@/i18n/tags';
import { getServerDb } from '@/lib/supabase-server';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Marked sold out mid-service, this has to catch up within the shift it
// changed in - see the same note on the food menu's revalidate.
export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  const path = locale === routing.defaultLocale ? '/drinks' : `/${locale}/drinks`;

  return {
    title: t('drinksTitle'),
    description: t('drinksDescription', { venue: VENUE.name, street: VENUE.street }),
    alternates: {
      canonical: path,
      languages: { en: '/drinks', 'nl-BE': '/nl/drinks', 'fr-BE': '/fr/drinks', 'x-default': '/drinks' },
    },
  };
}

/**
 * The table menu, at a stable URL so the QR code on the printed card can point
 * here permanently. Nothing on this page should ever require a reprint - which
 * is also why English stayed on `/drinks` when Dutch arrived, rather than
 * everything moving under a locale prefix.
 */
export default async function DrinksPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('drinksPage');
  const db = getServerDb();
  const [sections, updatedAt] = await Promise.all([fetchBarList(db), fetchBarListUpdatedAt(db)]);
  const listUpdated = updatedAt
    ? new Intl.DateTimeFormat(LOCALE_TAG[locale], {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Brussels',
      }).format(new Date(updatedAt))
    : null;

  return (
    <main>
      {/* The same header every other page wears - no lean QR-code variant.
          Food menu and every other page are one tap away in the nav either
          way, so a page-specific cross-link only duplicated what's already
          there. */}
      <SiteNav />

      <DrinksMenu sections={sections} />

      <footer className="mx-auto max-w-2xl px-4 pb-14 text-[0.72rem] text-[var(--text-muted)]">
        <p>{t('lastCall', { time: LAST_CALL_KITCHEN })}</p>
        {listUpdated && <p className="mt-1.5">{t('updated', { date: listUpdated })}</p>}
      </footer>
    </main>
  );
}
