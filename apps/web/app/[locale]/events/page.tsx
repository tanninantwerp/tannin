import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VENUE } from '@tannin/core';
import { fetchPublishedEvents } from '@tannin/supabase';
import { SiteNav } from '@/components/SiteNav';
import { Events } from '@/components/Events';
import { SiteFooter } from '@/components/SiteFooter';
import { alternatesFor } from '@/lib/metadata';
import { getServerDb } from '@/lib/supabase-server';
import { routing, type Locale } from '@/i18n/routing';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  const title = t('eventsTitle');
  const description = t('eventsDescription');
  const alternates = alternatesFor('/events', locale as Locale);

  return {
    title,
    description,
    alternates,
    openGraph: { title, description, url: alternates.canonical },
  };
}

/** What's on - café society, workshops, evenings with CE-LLAR. */
export default async function EventsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const events = await fetchPublishedEvents(getServerDb()).catch(() => []);

  // Event schema for the dated ones - search engines surface these as events.
  const jsonLd = events
    .filter((e) => e.startsOn)
    .map((e) => ({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: e.title,
      startDate: e.startsOn,
      ...(e.endsOn ? { endDate: e.endsOn } : {}),
      eventStatus: 'https://schema.org/EventScheduled',
      description: e.summary ?? e.body ?? undefined,
      ...(e.imageUrl ? { image: e.imageUrl } : {}),
      location: {
        '@type': 'Place',
        name: e.location ?? VENUE.name,
        address: {
          '@type': 'PostalAddress',
          streetAddress: VENUE.street,
          addressLocality: VENUE.city,
          postalCode: VENUE.postcode,
          addressCountry: 'BE',
        },
      },
      organizer: { '@type': 'Organization', name: VENUE.name },
    }));

  return (
    <>
      <SiteNav />
      <main>
        <Events events={events} />
      </main>
      <SiteFooter />
      {jsonLd.length > 0 && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
    </>
  );
}
