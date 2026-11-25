import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SiteNav } from '@/components/SiteNav';
import { IN_HOUSE_BOOK } from '@/components/nav-links';
import { BookingForm } from '@/components/BookingForm';
import { SiteFooter } from '@/components/SiteFooter';
import { alternatesFor } from '@/lib/metadata';
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
  const title = t('bookTitle');
  const description = t('bookDescription');
  const alternates = alternatesFor('/book', locale as Locale);

  return {
    title,
    description,
    alternates,
    openGraph: { title, description, url: alternates.canonical },
  };
}

/**
 * The form is a client component and the availability it draws comes from the
 * browser, so there is nothing here worth rendering on the server beyond the
 * chrome around it.
 */
export default async function BookPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <SiteNav book={IN_HOUSE_BOOK} />
      <main>
        <BookingForm />
      </main>
      <SiteFooter />
    </>
  );
}
