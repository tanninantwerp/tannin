import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SiteNav } from '@/components/SiteNav';
import { Visit } from '@/components/Visit';
import { SiteFooter } from '@/components/SiteFooter';
import { alternatesFor } from '@/lib/metadata';
import { openingHours, upcomingHoursExceptions } from '@/lib/hours';
import { routing, type Locale } from '@/i18n/routing';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  const title = t('visitTitle');
  const description = t('visitDescription');
  const alternates = alternatesFor('/visit', locale as Locale);

  return {
    title,
    description,
    alternates,
    openGraph: { title, description, url: alternates.canonical },
  };
}

/** Hours, both addresses, and the shop across the road. */
export default async function VisitPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [windows, exceptions] = await Promise.all([openingHours(), upcomingHoursExceptions()]);

  return (
    <>
      <SiteNav />
      <main>
        <Visit windows={windows} exceptions={exceptions} />
      </main>
      <SiteFooter />
    </>
  );
}
