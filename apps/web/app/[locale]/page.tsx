import { setRequestLocale } from 'next-intl/server';
import { HomeContent } from '@/components/HomeContent';
import { routing } from '@/i18n/routing';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/*
 * 30 seconds, matching /menu, /drinks and /wine.
 *
 * An hour was "plenty" on the assumption that `revalidateHomepage()` in the
 * admin would clear the cache the moment staff curated something, making the
 * window a backstop rather than the actual wait. It is not: that ping defaults
 * to `https://ta-nnin.be`, which is not this deployment - it currently answers
 * 404 from somebody else's site - and the call swallows its own failure. So the
 * hour was the real delay, and a post published in the admin sat invisible on
 * the home page for up to sixty minutes with nothing to show for it.
 *
 * Fixing the ping (set NEXT_PUBLIC_WEB_URL on the admin project) makes updates
 * immediate again, but the page should not depend on a fire-and-forget request
 * to a URL that can drift. Thirty seconds is what the other content pages
 * already use, and it costs one regeneration per half minute at most, and only
 * when somebody actually asks for the page.
 */
export const revalidate = 30;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main>
      <HomeContent />
    </main>
  );
}
