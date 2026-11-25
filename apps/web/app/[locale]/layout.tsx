import type { Metadata, Viewport } from 'next';
import { Voces, Work_Sans } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VENUE } from '@tannin/core';
import type { ServiceWindow } from '@tannin/core';
import { routing, type Locale } from '@/i18n/routing';
import { LOCALE_TAG } from '@/i18n/tags';
import { IS_LIVE_SITE, SITE_URL } from '@/lib/site';
import { openingHours } from '@/lib/hours';
import { ScrollToTop } from '@/components/ScrollToTop';
import '../globals.css';

const voces = Voces({
  weight: ['400'],
  subsets: ['latin'],
  variable: '--font-voces',
  display: 'swap',
});

const workSans = Work_Sans({
  subsets: ['latin'],
  variable: '--font-work-sans',
  display: 'swap',
});

/** Every locale is known up front, so all of them prerender at build time. */
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
  const description = t('description');

  // English keeps the bare paths it has always had; Dutch and French sit under /nl and /fr.
  const path = locale === routing.defaultLocale ? '' : `/${locale}`;

  return {
    // Wherever this deployment is, not where the site is going. On the demo
    // these three used to say `ta-nnin.be` while the pages were served from a
    // Vercel URL, which tells Google the real page is somewhere it is not.
    metadataBase: new URL(SITE_URL),
    title: {
      default: `${VENUE.name} - ${VENUE.strapline}, Antwerpen`,
      template: `%s - ${VENUE.name}`,
    },
    description,
    keywords: t('keywords').split(', '),
    /*
     * The demo and every preview stay out of the index. robots.txt asks a
     * crawler not to fetch; this is what keeps the page out of results if one
     * finds it by a link anyway, which robots.txt alone does not do.
     */
    ...(IS_LIVE_SITE ? {} : { robots: { index: false, follow: false } }),
    openGraph: {
      title: `${VENUE.name} - ${VENUE.strapline}`,
      description,
      url: `${SITE_URL}${path || '/'}`,
      siteName: VENUE.name,
      locale: t('ogLocale'),
      alternateLocale: (['en_GB', 'nl_BE', 'fr_BE'] as const).filter((l) => l !== t('ogLocale')),
      type: 'website',
      images: [{ url: '/brand/photo-6.jpg', width: 1800, height: 1205, alt: t('ogImageAlt') }],
    },
    alternates: {
      canonical: path || '/',
      languages: {
        en: '/',
        'nl-BE': '/nl',
        'fr-BE': '/fr',
        'x-default': '/',
      },
    },
  };
}

/**
 * The ink the site opens on, not the paper it is printed on.
 *
 * iOS Safari tints its own chrome - the status bar behind the clock and the
 * camera, and the address bar - with `theme-color`. This used to follow the
 * page surface: cream in light mode, near-black in dark. But no page actually
 * begins on the cream: every route opens on a black band, either the hero on
 * the home page and the demo, or the sticky header everywhere else. So on an
 * iPhone the site began with a strip of white sitting directly above a black
 * hero, which read as a rendering fault rather than as a design.
 *
 * One value, and deliberately not per-scheme: that band is `--color-ink` in
 * both schemes, so offering a light variant would only reintroduce the seam
 * for anyone whose phone is set to light.
 */
export const viewport: Viewport = {
  themeColor: '#000105',
};

/**
 * Structured data so Google can show the address and opening hours directly in
 * the results. For a place people search by name, this is worth more than any
 * amount of copy on the page.
 */
const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function jsonLdFor(description: string, locale: Locale, windows: readonly ServiceWindow[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BarOrPub',
    name: VENUE.name,
    description,
    // The language of this description, not of the venue.
    inLanguage: LOCALE_TAG[locale],
    address: {
      '@type': 'PostalAddress',
      streetAddress: VENUE.street,
      postalCode: VENUE.postcode,
      addressLocality: VENUE.city,
      addressCountry: 'BE',
    },
    telephone: VENUE.phone,
    email: VENUE.email,
    servesCuisine: ['Wine bar', 'Small plates'],
    priceRange: '€€',
    // Derived from the single source of truth, so the hours in the search result
    // can never drift from the hours on the page.
    openingHoursSpecification: windows.map((w) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: SCHEMA_DAYS[w.weekday],
      opens: w.opens,
      closes: w.closes,
    })),
    sameAs: [`https://instagram.com/${VENUE.instagram.replace('@', '')}`],
    url: SITE_URL,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Opts the whole tree into static rendering rather than a render per request.
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'meta' });
  const windows = await openingHours();

  return (
    <html lang={LOCALE_TAG[locale]} className={`${voces.variable} ${workSans.variable}`}>
      <body>
        <script
          type="application/ld+json"
          // Object we author ourselves - no user input reaches this.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFor(t('description'), locale, windows)) }}
        />
        <NextIntlClientProvider>
          <ScrollToTop />
          {/* The paper surface lives here rather than on the body - see globals.css. */}
          <div className="bg-[var(--surface)]">{children}</div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
