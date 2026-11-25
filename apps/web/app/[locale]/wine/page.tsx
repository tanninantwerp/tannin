import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { fetchWines } from '@tannin/supabase';
import { SiteNav } from '@/components/SiteNav';
import { WineList } from '@/components/WineList';
import { SiteFooter } from '@/components/SiteFooter';
import { alternatesFor } from '@/lib/metadata';
import { getServerDb } from '@/lib/supabase-server';
import { routing, type Locale } from '@/i18n/routing';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Tawat turns a bottle on and off from the cellar itself - the site should
// catch up within the shift, same as the food and bar lists.
export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  const wines = await fetchWines(getServerDb());
  const title = t('wineTitle');
  const description = t('wineDescription', { count: wines.length });
  const alternates = alternatesFor('/wine', locale as Locale);

  return {
    title,
    description,
    alternates,
    openGraph: { title, description, url: alternates.canonical },
  };
}

/** The cellar, on a URL you can send to someone. */
export default async function WinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const wines = await fetchWines(getServerDb());

  return (
    <>
      <SiteNav />
      <main>
        <WineList wines={wines} />
      </main>
      <SiteFooter />
    </>
  );
}
