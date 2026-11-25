import { getTranslations, setRequestLocale } from 'next-intl/server';
import { voucherAmountLabel, voucherDateLabel, VENUE } from '@tannin/core';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { Link } from '@/i18n/navigation';
import { GIFT_ENABLED, fulfil, type Fulfilment } from '@/lib/gift';

// One buyer's voucher: never cached, never indexed.
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Where Stripe sends the buyer after paying.
 *
 * Finishes the order itself rather than waiting for the webhook - the two race,
 * and the buyer should see their code now, not after a refresh. `fulfil` makes
 * that safe: whichever arrives second finds the voucher already made.
 */
export default async function GiftThanksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('gift');

  const { session_id: sessionId = '' } = await searchParams;
  const result: Fulfilment =
    GIFT_ENABLED && sessionId.startsWith('cs_') ? await fulfil(sessionId) : { state: 'unknown' };

  return (
    <>
      <SiteNav />
      <main>
        <section className="mx-auto max-w-xl px-5 py-24 text-center">
          {result.state === 'ready' ? (
            <>
              <p className="text-[0.68rem] uppercase tracking-[0.3em] text-[var(--accent)]">{t('thanksEyebrow')}</p>
              <h1 className="mt-5 font-[family-name:var(--font-voces)] text-3xl">{t('thanksHeading')}</h1>
              <p className="mt-5 leading-relaxed text-[var(--text-muted)]">
                {t('thanksBody', { email: result.voucher.buyer_email ?? '' })}
              </p>
              <dl className="mx-auto mt-10 grid max-w-sm grid-cols-[auto_1fr] gap-x-6 gap-y-3 border-y border-[var(--surface-edge)] py-6 text-left">
                <dt className="text-[0.72rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">{t('labelValue')}</dt>
                <dd className="text-right tabular-nums">€ {voucherAmountLabel(result.voucher.amount_cents)}</dd>
                <dt className="text-[0.72rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">{t('labelCode')}</dt>
                <dd className="text-right font-medium tracking-[0.08em]">{result.voucher.code}</dd>
                <dt className="text-[0.72rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">{t('labelValid')}</dt>
                <dd className="text-right tabular-nums">{voucherDateLabel(result.voucher.valid_until!)}</dd>
              </dl>
              <a
                href={`/api/gift/pdf?session_id=${encodeURIComponent(sessionId)}`}
                className="mt-10 inline-block bg-[var(--color-neon-yellow)] px-6 py-4 text-[0.75rem] uppercase tracking-[0.2em] text-[var(--color-ink)] transition-opacity hover:opacity-90"
              >
                {t('download')}
              </a>
            </>
          ) : result.state === 'unpaid' ? (
            <>
              <p className="text-[0.68rem] uppercase tracking-[0.3em] text-[var(--accent)]">{t('pendingEyebrow')}</p>
              <h1 className="mt-5 font-[family-name:var(--font-voces)] text-3xl">{t('pendingHeading')}</h1>
              <p className="mt-5 leading-relaxed text-[var(--text-muted)]">{t('pendingBody')}</p>
            </>
          ) : (
            <>
              <h1 className="font-[family-name:var(--font-voces)] text-3xl">{t('unknownHeading')}</h1>
              <p className="mt-5 leading-relaxed text-[var(--text-muted)]">
                {t('unknownBody', { email: VENUE.email })}
              </p>
              <Link href="/gift" className="mt-8 inline-block underline underline-offset-4">
                {t('backToGift')}
              </Link>
            </>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
