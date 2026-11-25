'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { VENUE } from '@tannin/core';
import { LOCALE_TAG } from '@/i18n/tags';
import type { Locale } from '@/i18n/routing';

export interface ManageableBooking {
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  status: string;
}

/**
 * What a guest can do with their own booking, which is exactly one thing.
 *
 * Changing a date or a party size is not offered on purpose: it is the same
 * problem as making a new booking, and doing it badly means holding two tables
 * while the guest thinks about it. Cancel and rebook is honest and cannot leave
 * the room in a wrong state.
 */
export function ManageBooking({ booking, token }: { booking: ManageableBooking; token: string }) {
  const t = useTranslations('manage');
  const locale = useLocale() as Locale;

  const [status, setStatus] = useState(booking.status);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const when = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${booking.date}T12:00:00Z`));

  const past = booking.date < new Date().toISOString().slice(0, 10);
  const done = status === 'cancelled' || status === 'seated' || status === 'no_show';

  async function cancel() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch('/api/bookings/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as { status?: string };
      setStatus(result.status ?? 'cancelled');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section className="mx-auto max-w-lg px-5 py-20 sm:py-28">
      <p className="text-[0.68rem] uppercase tracking-[0.3em] text-[var(--accent)]">
        {t('eyebrow')}
      </p>
      <h1 className="mt-5 font-[family-name:var(--font-voces)] text-3xl">
        {t('heading', { name: booking.guestName })}
      </h1>

      <dl className="mt-10 border-t border-[var(--surface-edge)]">
        {[
          [t('when'), `${when}, ${booking.time.slice(0, 5)}`],
          [t('who'), String(booking.partySize)],
          [t('state'), t(`status.${status}`)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-6 border-b border-[var(--surface-edge)] py-3.5"
          >
            <dt className="text-[0.72rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
              {label}
            </dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>

      {status === 'cancelled' ? (
        <p className="mt-8 leading-relaxed text-[var(--text-muted)]">{t('cancelledNote')}</p>
      ) : past || done ? (
        <p className="mt-8 leading-relaxed text-[var(--text-muted)]">{t('nothingToDo')}</p>
      ) : confirming ? (
        <div className="mt-8">
          <p className="leading-relaxed">{t('sure')}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={cancel}
              disabled={busy}
              className="bg-[var(--text)] px-5 py-3 text-[0.75rem] uppercase tracking-[0.2em] text-[var(--surface)] disabled:opacity-50"
            >
              {busy ? t('cancelling') : t('confirmCancel')}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="border border-[var(--surface-edge)] px-5 py-3 text-[0.75rem] uppercase tracking-[0.2em]"
            >
              {t('keep')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-8">
          <button
            onClick={() => setConfirming(true)}
            className="border border-[var(--surface-edge)] px-5 py-3 text-[0.75rem] uppercase tracking-[0.2em] hover:border-[var(--accent)]"
          >
            {t('cancel')}
          </button>
          <p className="mt-4 text-[0.85rem] leading-relaxed text-[var(--text-muted)]">
            {t('changeNote', { phone: VENUE.phone })}
          </p>
        </div>
      )}

      {failed && <p className="mt-5 text-[0.85rem] text-[var(--accent)]">{t('failed')}</p>}
    </section>
  );
}
