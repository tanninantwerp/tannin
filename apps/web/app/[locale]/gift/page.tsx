import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SiteNav } from '@/components/SiteNav';
import { GiftForm } from '@/components/GiftForm';
import { SiteFooter } from '@/components/SiteFooter';
import { STRIPE_PUBLISHABLE_KEY } from '@/lib/gift';
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
  const title = t('giftTitle');
  const description = t('giftDescription');
  const alternates = alternatesFor('/gift', locale as Locale);

  return {
    title,
    description,
    alternates,
    openGraph: { title, description, url: alternates.canonical },
  };
}

/**
 * Gift vouchers. The order form always shows, set up or not (Sacha,
 * 2026-11-01): if the Stripe or service keys are missing, the buyer gets the
 * "did not go through, email us" message when they try to pay.
 */
export default async function GiftPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <SiteNav />
      <main>
        <GiftForm publishableKey={STRIPE_PUBLISHABLE_KEY} />
      </main>
      <SiteFooter />
    </>
  );
}
