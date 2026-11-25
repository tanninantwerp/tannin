import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SHOP } from '@tannin/core';
import { fetchPublishedEvents, fetchWines } from '@tannin/supabase';
import { SiteNav } from '@/components/SiteNav';
import { Cellar } from '@/components/Cellar';
import { SiteFooter } from '@/components/SiteFooter';
import { alternatesFor } from '@/lib/metadata';
import { getServerDb } from '@/lib/supabase-server';
import { routing, type Locale } from '@/i18n/routing';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Events and the shop's bottles are edited in admin; catch up within the shift,
// same as the wine list.
export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  const title = t('cellarTitle');
  const description = t('cellarDescription', { street: SHOP.street });
  const alternates = alternatesFor('/cellar', locale as Locale);

  return {
    title,
    description,
    alternates,
    openGraph: { title, description, url: alternates.canonical },
  };
}

/** CE-LLAR, the bottle shop and event space across the road. */
export default async function CellarPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const db = getServerDb();
  // Either list failing leaves its section out; the shop's own facts still render.
  const [events, wines] = await Promise.all([
    fetchPublishedEvents(db).catch(() => []),
    fetchWines(db).catch(() => []),
  ]);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WineShop',
    name: SHOP.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: SHOP.street,
      addressLocality: SHOP.city,
      postalCode: SHOP.postcode,
      addressCountry: 'BE',
    },
    email: SHOP.eventsEmail,
    sameAs: [`https://instagram.com/${SHOP.instagram.replace('@', '')}`],
    openingHoursSpecification: SHOP.hours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][h.weekday],
      opens: h.opens,
      closes: h.closes,
    })),
  };

  return (
    <>
      <SiteNav />
      <main>
        <Cellar events={events} wines={wines} />
      </main>
      <SiteFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
