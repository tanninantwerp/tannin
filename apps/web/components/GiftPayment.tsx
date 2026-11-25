'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { loadStripe, type Appearance } from '@stripe/stripe-js';
import { CheckoutElementsProvider, PaymentElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout';
import { VENUE } from '@tannin/core';

/**
 * The payment step of /gift, drawn on our own page instead of Stripe's.
 *
 * The card number, expiry and CVC still live in Stripe's fields - iframes the
 * page cannot read, which is what keeps card data off our servers - but they
 * are styled from the site's own palette and type, so the step reads as part
 * of the form above it rather than a hand-off to someone else.
 *
 * Paying confirms the Checkout Session the server opened; Stripe then sends
 * the buyer to the thank-you page (via their bank first, for 3D Secure or
 * Bancontact), which issues the voucher exactly as before.
 */

// Stripe.js is loaded once per key, not once per render.
const stripeFor = new Map<string, ReturnType<typeof loadStripe>>();
function stripePromise(key: string) {
  if (!stripeFor.has(key)) stripeFor.set(key, loadStripe(key));
  return stripeFor.get(key)!;
}

/*
 * The fields sit in iframes, so they cannot see the page's CSS variables; the
 * two palettes below are the light and dark tokens from globals.css, written
 * out. Square corners and the uppercase tracked labels match the rest of the
 * form.
 */
const LIGHT = {
  colorBackground: '#f3f0e9',
  colorText: '#000105',
  colorTextSecondary: '#5c6462',
  colorPrimary: '#2f5d59',
  colorDanger: '#a8341f',
  edge: 'rgba(0, 1, 5, 0.12)',
};
const DARK = {
  colorBackground: '#0d1011',
  colorText: '#ece9e2',
  colorTextSecondary: '#9aa3a1',
  colorPrimary: '#a8c6c2',
  colorDanger: '#e07a6b',
  edge: 'rgba(168, 198, 194, 0.16)',
};

function appearanceFor(dark: boolean): Appearance {
  const { edge, ...colors } = dark ? DARK : LIGHT;
  return {
    theme: 'flat',
    variables: {
      ...colors,
      fontFamily: '"Work Sans", ui-sans-serif, system-ui, sans-serif',
      fontSizeBase: '15px',
      borderRadius: '0px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': { backgroundColor: 'transparent', border: `1px solid ${edge}`, boxShadow: 'none', padding: '10px 12px' },
      '.Input:focus': { border: `1px solid ${colors.colorPrimary}`, boxShadow: 'none' },
      '.Input--invalid': { border: `1px solid ${colors.colorDanger}`, boxShadow: 'none' },
      '.Label': { textTransform: 'uppercase', letterSpacing: '0.2em', fontSize: '11.5px', marginBottom: '8px' },
      '.Tab': { backgroundColor: 'transparent', border: `1px solid ${edge}`, boxShadow: 'none' },
      '.Tab--selected': { border: `1px solid ${colors.colorPrimary}`, boxShadow: 'none' },
      '.Error': { fontSize: '12.8px' },
    },
  };
}

/** Follows the site's theme: the viewer's own toggle first, then the system. */
function useDarkTheme(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      media.addEventListener('change', onChange);
      return () => {
        observer.disconnect();
        media.removeEventListener('change', onChange);
      };
    },
    () => {
      const chosen = document.documentElement.dataset.theme;
      return chosen ? chosen === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    },
    () => false,
  );
}

export function GiftPayment({
  publishableKey,
  clientSecret,
  amountEuros,
  recipientName,
  onBack,
}: {
  publishableKey: string;
  clientSecret: string;
  amountEuros: number;
  recipientName: string;
  onBack: () => void;
}) {
  const dark = useDarkTheme();
  const t = useTranslations('gift');
  // The provider takes its options once, so the theme it starts with is the one
  // it keeps; `key` remounts it if the viewer flips the theme mid-payment.
  const options = useMemo(
    () => ({
      clientSecret,
      elementsOptions: {
        appearance: appearanceFor(dark),
        fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500&display=swap' }],
      },
    }),
    [clientSecret, dark],
  );

  // Without the publishable key Stripe.js cannot start; say so plainly
  // rather than leave an empty box.
  if (!publishableKey) {
    return <p className="text-[0.85rem] text-[var(--danger)]">{t('failed', { email: VENUE.email })}</p>;
  }

  return (
    <CheckoutElementsProvider key={dark ? 'dark' : 'light'} stripe={stripePromise(publishableKey)} options={options}>
      <PaymentStep amountEuros={amountEuros} recipientName={recipientName} onBack={onBack} />
    </CheckoutElementsProvider>
  );
}

function PaymentStep({
  amountEuros,
  recipientName,
  onBack,
}: {
  amountEuros: number;
  recipientName: string;
  onBack: () => void;
}) {
  const t = useTranslations('gift');
  const state = useCheckoutElements();
  const [paying, setPaying] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (state.type !== 'success') return;
    setPaying(true);
    setFailed(null);
    // On success Stripe navigates away, so the button stays disabled on purpose.
    const result = await state.checkout.confirm();
    if (result.type === 'error') {
      setFailed(result.error.message || t('failed', { email: VENUE.email }));
      setPaying(false);
    }
  }

  return (
    <form onSubmit={pay} noValidate className="flex flex-col gap-8">
      <div className="border-y border-[var(--surface-edge)] py-5">
        <p className="text-[0.72rem] uppercase tracking-[0.2em]">{t('payHeading')}</p>
        <p className="mt-3 flex items-baseline justify-between gap-4">
          <span className="text-[var(--text-muted)]">{t('paySummary', { name: recipientName })}</span>
          <span className="font-[family-name:var(--font-voces)] text-2xl tabular-nums">€ {amountEuros}</span>
        </p>
        <button
          type="button"
          onClick={onBack}
          disabled={paying}
          className="mt-3 text-[0.8rem] underline underline-offset-4 disabled:opacity-50"
        >
          {t('payChange')}
        </button>
      </div>

      {state.type === 'error' ? (
        <p className="text-[0.85rem] text-[var(--danger)]">{t('failed', { email: VENUE.email })}</p>
      ) : (
        <div className="min-h-40">
          {state.type === 'loading' && <p className="text-[0.85rem] text-[var(--text-muted)]">{t('submitting')}</p>}
          {/* No Link sign-up box: buyers come once a year, not often enough to save a card. */}
          <PaymentElement options={{ layout: { type: 'tabs' }, wallets: { link: 'never' } }} />
        </div>
      )}

      {failed && <p className="text-[0.85rem] text-[var(--danger)]">{failed}</p>}

      <div>
        <button
          type="submit"
          disabled={paying || state.type !== 'success'}
          className="w-full bg-[var(--color-neon-yellow)] px-6 py-4 text-[0.75rem] uppercase tracking-[0.2em] text-[var(--color-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
        >
          {paying ? t('submitting') : t('submitAmount', { amount: amountEuros })}
        </button>
        <p className="mt-4 text-[0.8rem] leading-relaxed text-[var(--text-muted)]">{t('payNote')}</p>
      </div>
    </form>
  );
}
