import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { HomeContent } from '@/components/HomeContent';
import { routing } from '@/i18n/routing';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * The home page with the sign lit in the brand turquoise instead of red.
 *
 * One of two colourways up for comparison (`/home2` yellow, `/home3` turquoise)
 * against the red on `/`. The page is the real home page - same sections, same
 * live data - because a neon colour can only really be judged over the actual
 * photo with the actual type around it.
 *
 * Kept out of search: it is a duplicate of `/` down to the copy, and two more
 * of those competing with the home page for "wine bar antwerpen" is the last
 * thing the site needs. Reached by being handed the link.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const revalidate = 30;

export default async function Home3Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main>
      <HomeContent neon="turquoise" />
    </main>
  );
}
