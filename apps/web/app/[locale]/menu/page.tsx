import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { fetchMenu } from '@tannin/supabase';
import { SiteNav } from '@/components/SiteNav';
import { MenuBoard } from '@/components/MenuBoard';
import { SiteFooter } from '@/components/SiteFooter';
import { alternatesFor } from '@/lib/metadata';
import { getServerDb } from '@/lib/supabase-server';
import { routing, type Locale } from '@/i18n/routing';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// The kitchen switches this list mid-shift - sold out, a price, a new dish.
// Thirty seconds old is close enough for a menu, and far better than the
// hour-plus a full rebuild would otherwise sit stale for.
export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  const title = t('menuTitle');
  const description = t('menuDescription');
  const alternates = alternatesFor('/menu', locale as Locale);

  return {
    title,
    description,
    alternates,
    openGraph: { title, description, url: alternates.canonical },
  };
}

/** Both food cards - the kitchen, and the afterhours one that runs until late. */
export default async function MenuPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sections = await fetchMenu(getServerDb());

  return (
    <>
      <SiteNav />
      <main>
        <MenuBoard sections={sections} />
      </main>
      <SiteFooter />
    </>
  );
}
