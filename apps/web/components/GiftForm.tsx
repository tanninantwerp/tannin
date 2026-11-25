'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import {
  GIFT_FIELD_LIMITS,
  GIFT_MAX_EUROS,
  GIFT_MIN_EUROS,
  GIFT_PRESETS,
  SHOP,
  VENUE,
  validateGiftOrder,
  type GiftDraft,
} from '@tannin/core';
import { GiftPayment } from './GiftPayment';

/**
 * Buying a gift voucher.
 *
 * Fills in exactly what the printed card has room for - who it is for, who it
 * is from, a short note - plus the amount and where to send it. Then the same
 * column turns into the payment step (`GiftPayment`), whose card fields are
 * Stripe's, so this page never sees a card number.
 *
 * Validation runs on blur and on submit, as on the booking form, and the same
 * function runs again on the server.
 */
export function GiftForm({ publishableKey }: { publishableKey: string }) {
  const t = useTranslations('gift');
  const locale = useLocale();

  const [preset, setPreset] = useState<number | null>(50);
  const [custom, setCustom] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [fromName, setFromName] = useState('');
  const [note, setNote] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [sendToRecipient, setSendToRecipient] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const amountEuros = preset ?? (custom.trim() ? Number(custom.replace(',', '.')) : undefined);
  const draft: GiftDraft = { amountEuros, recipientName, fromName, note, buyerEmail, sendToRecipient, recipientEmail };
  const errors = validateGiftOrder(draft);

  const messageFor = (field: keyof GiftDraft) =>
    touched[field] && errors[field]
      ? t(`errors.${errors[field]}`, { min: GIFT_MIN_EUROS, max: GIFT_MAX_EUROS })
      : null;
  const touch = (field: keyof GiftDraft) => setTouched((s) => ({ ...s, [field]: true }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({
      amountEuros: true,
      recipientName: true,
      fromName: true,
      note: true,
      buyerEmail: true,
      recipientEmail: true,
    });
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setFailed(null);
    try {
      const response = await fetch('/api/gift/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, locale }),
      });
      const result = (await response.json()) as { clientSecret?: string };
      if (!response.ok || !result.clientSecret) throw new Error(String(response.status));
      setClientSecret(result.clientSecret);
    } catch {
      setFailed(t('failed', { email: VENUE.email }));
    }
    setSubmitting(false);
  }

  return (
    <section className="mx-auto max-w-5xl px-5 py-16 sm:py-24">
      <div className="grid gap-12 md:grid-cols-[1fr_1.05fr] md:gap-16">
        <div>
          <p className="text-[0.68rem] uppercase tracking-[0.3em] text-[var(--accent)]">{t('eyebrow')}</p>
          <h1 className="mt-5 font-[family-name:var(--font-voces)] text-4xl">{t('heading')}</h1>
          <p className="mt-5 leading-relaxed text-[var(--text-muted)]">
            {t('body', { bar: VENUE.name, shop: SHOP.name })}
          </p>
          <Image
            src="/gift/voucher.webp"
            alt={t('previewAlt')}
            width={840}
            height={1188}
            className="mx-auto mt-10 w-full max-w-sm border border-[var(--surface-edge)] shadow-sm"
            priority
          />
          <ul className="mt-6 flex flex-col gap-1.5 text-[0.85rem] leading-relaxed text-[var(--text-muted)]">
            <li>{t('factValid')}</li>
            <li>{t('factSplit')}</li>
            <li>{t('factBoth', { bar: VENUE.name, shop: SHOP.name })}</li>
          </ul>
        </div>

        {clientSecret && amountEuros ? (
          <GiftPayment
            publishableKey={publishableKey}
            clientSecret={clientSecret}
            amountEuros={amountEuros}
            recipientName={recipientName}
            // Changing anything means a new order; the abandoned one voids
            // itself when its session expires.
            onBack={() => setClientSecret(null)}
          />
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-10">
            <fieldset>
              <legend className="text-[0.72rem] uppercase tracking-[0.2em]">{t('amountLabel')}</legend>
              <div className="mt-4 flex flex-wrap gap-2">
                {GIFT_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setPreset(n);
                      setCustom('');
                    }}
                    aria-pressed={preset === n}
                    className={`h-11 min-w-16 border px-3 text-[0.9rem] tabular-nums transition-colors ${
                      preset === n
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--color-paper)]'
                        : 'border-[var(--surface-edge)] hover:border-[var(--accent)]'
                    }`}
                  >
                    € {n}
                  </button>
                ))}
              </div>
              <label htmlFor="gift-custom" className="mt-4 flex max-w-xs flex-col gap-2">
                <span className="text-[0.8rem] text-[var(--text-muted)]">
                  {t('customLabel', { min: GIFT_MIN_EUROS, max: GIFT_MAX_EUROS })}
                </span>
                <input
                  id="gift-custom"
                  inputMode="numeric"
                  value={custom}
                  placeholder="€"
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setPreset(null);
                  }}
                  onBlur={() => touch('amountEuros')}
                  aria-invalid={messageFor('amountEuros') ? true : undefined}
                  className={`border bg-transparent px-3 py-2.5 text-[0.95rem] tabular-nums outline-none focus:border-[var(--accent)] ${
                    messageFor('amountEuros') ? 'border-[var(--accent)]' : 'border-[var(--surface-edge)]'
                  }`}
                />
              </label>
              {messageFor('amountEuros') && (
                <p className="mt-3 text-[0.8rem] text-[var(--accent)]">{messageFor('amountEuros')}</p>
              )}
            </fieldset>

            <div className="flex flex-col gap-6">
              <Field
                id="gift-recipient"
                label={t('recipientLabel')}
                value={recipientName}
                onChange={setRecipientName}
                onBlur={() => touch('recipientName')}
                error={messageFor('recipientName')}
                maxLength={GIFT_FIELD_LIMITS.recipientName}
              />
              <Field
                id="gift-from"
                label={t('fromLabel')}
                value={fromName}
                onChange={setFromName}
                onBlur={() => touch('fromName')}
                error={messageFor('fromName')}
                maxLength={GIFT_FIELD_LIMITS.fromName}
                autoComplete="name"
              />
              <label htmlFor="gift-note" className="flex flex-col gap-2">
                <span className="text-[0.72rem] uppercase tracking-[0.2em]">{t('noteLabel')}</span>
                <textarea
                  id="gift-note"
                  rows={2}
                  value={note}
                  maxLength={GIFT_FIELD_LIMITS.note}
                  placeholder={t('notePlaceholder')}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => touch('note')}
                  className="resize-none border border-[var(--surface-edge)] bg-transparent px-3 py-2.5 text-[0.95rem] outline-none focus:border-[var(--accent)]"
                />
                <span className="text-right text-[0.75rem] tabular-nums text-[var(--text-muted)]">
                  {note.length}/{GIFT_FIELD_LIMITS.note}
                </span>
              </label>
              <Field
                id="gift-email"
                type="email"
                label={t('emailLabel')}
                hint={t('emailHint')}
                value={buyerEmail}
                onChange={setBuyerEmail}
                onBlur={() => touch('buyerEmail')}
                error={messageFor('buyerEmail')}
                maxLength={GIFT_FIELD_LIMITS.email}
                autoComplete="email"
              />
              <label className="flex cursor-pointer gap-3 text-[0.9rem] leading-snug">
                <input
                  type="checkbox"
                  checked={sendToRecipient}
                  onChange={(e) => setSendToRecipient(e.target.checked)}
                  className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                />
                <span>
                  {t('sendToRecipient')}
                  <span className="mt-1 block text-[0.8rem] text-[var(--text-muted)]">{t('sendToRecipientHint')}</span>
                </span>
              </label>
              {sendToRecipient && (
                <Field
                  id="gift-recipient-email"
                  type="email"
                  label={t('recipientEmailLabel')}
                  value={recipientEmail}
                  onChange={setRecipientEmail}
                  onBlur={() => touch('recipientEmail')}
                  error={messageFor('recipientEmail')}
                  maxLength={GIFT_FIELD_LIMITS.email}
                />
              )}
            </div>

            {failed && <p className="text-[0.85rem] text-[var(--accent)]">{failed}</p>}

            <div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-[var(--color-neon-yellow)] px-6 py-4 text-[0.75rem] uppercase tracking-[0.2em] text-[var(--color-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
              >
                {submitting ? t('submitting') : t('submit')}
              </button>
              <p className="mt-4 text-[0.8rem] leading-relaxed text-[var(--text-muted)]">{t('paymentNote')}</p>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  type = 'text',
  autoComplete,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string | null;
  hint?: string;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-2">
      <span className="text-[0.72rem] uppercase tracking-[0.2em]">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        className={`border bg-transparent px-3 py-2.5 text-[0.95rem] outline-none focus:border-[var(--accent)] ${
          error ? 'border-[var(--accent)]' : 'border-[var(--surface-edge)]'
        }`}
      />
      {error ? (
        <span className="text-[0.8rem] text-[var(--accent)]">{error}</span>
      ) : hint ? (
        <span className="text-[0.8rem] text-[var(--text-muted)]">{hint}</span>
      ) : null}
    </label>
  );
}
