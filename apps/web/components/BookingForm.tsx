'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  BOOKING_HORIZON_DAYS,
  FIELD_LIMITS,
  MAX_PARTY_ONLINE,
  VENUE,
  addDays,
  availabilityFor,
  toISODate,
  validateBooking,
} from '@tannin/core';
import type { Blackout, BookingArea, ServiceWindow } from '@tannin/core';
import { fetchPublicBlackouts, fetchServiceWindows } from '@tannin/supabase';
import { getDb } from '@/lib/supabase';
import { LOCALE_TAG } from '@/i18n/tags';
import type { Locale } from '@/i18n/routing';

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function shiftMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

const PARTY_SIZES = Array.from({ length: MAX_PARTY_ONLINE }, (_, i) => i + 1);

/** `undefined` is "no preference" - the default, and the only choice that can never narrow availability. */
const AREAS: readonly BookingArea[] = ['inside', 'terrace', 'bar'];

/**
 * Booking a table.
 *
 * Three decisions worth knowing about:
 *
 * Availability comes from two places on purpose. Which times the bar would
 * offer is worked out here, from the opening hours and the blackout dates in
 * `@tannin/core`. Which of those still have a free table is a question only
 * Postgres can answer, and it answers it through `free_slots` - a function that
 * returns times and nothing else. The anon key still cannot read the guest
 * book; it can only ask whether there is room.
 *
 * The date strip only offers days the room is actually open. A calendar that
 * lets you pick a Monday and then tells you off is a worse experience than one
 * that never offers the Monday.
 *
 * Validation runs on blur and on submit, never on the first keystroke. Being
 * told your email is wrong while you are still typing it is the single most
 * irritating thing a form can do.
 */
export function BookingForm() {
  const t = useTranslations('booking');
  const locale = useLocale() as Locale;

  const [blackouts, setBlackouts] = useState<readonly Blackout[] | null>(null);
  // The live opening hours; undefined until fetched, when availabilityFor falls
  // back to the built-in week, so a slow or failed fetch never hides the picker.
  const [windows, setWindows] = useState<readonly ServiceWindow[] | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);

  const [partySize, setPartySize] = useState(2);
  const [area, setArea] = useState<BookingArea | undefined>(undefined);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [emailed, setEmailed] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [free, setFree] = useState<string[] | null>(null);
  const [checkingSlots, setCheckingSlots] = useState(false);

  useEffect(() => {
    // A blackout list we cannot read is not a reason to hide the form - the
    // request still reaches the inbox, a human still reads it.
    fetchPublicBlackouts(getDb())
      .then(setBlackouts)
      .catch(() => {
        setBlackouts([]);
        setLoadError(true);
      });
    // Best-effort: if the hours cannot be read, availabilityFor uses the
    // built-in week, so the picker still works with today's schedule.
    fetchServiceWindows(getDb())
      .then(setWindows)
      .catch(() => setWindows(undefined));
  }, []);

  /*
   * Which days are open does not depend on how many people are coming - that
   * is a question about tables, and it is answered per-time by `free_slots`
   * below rather than per-day here.
   *
   * Computed per visible month rather than a flat 28-day window, now that the
   * date field is a real calendar: a guest can page forward and still see
   * which days that month are closed, rather than the strip simply running
   * out. `today` is fixed at first render - recomputing it as the clock ticks
   * would shift which cells are "past" mid-session for no reason a guest
   * would notice or want.
   */
  const [today] = useState(() => new Date());
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const monthDays = useMemo(() => {
    if (!blackouts) return [];
    const count = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: count }, (_, i) =>
      availabilityFor({ isoDate: toISODate(new Date(year, month, i + 1)), blackouts, today, windows }),
    );
  }, [blackouts, year, month, today, windows]);

  const horizon = addDays(today, BOOKING_HORIZON_DAYS);
  const atFirstMonth = year === today.getFullYear() && month === today.getMonth();
  const atLastMonth = year === horizon.getFullYear() && month === horizon.getMonth();

  const selected = monthDays.find((d) => d.date === date && d.bookable);

  /*
   * The schedule says which times we would offer; the database says which of
   * those still have a table. Asking it costs one round trip per day chosen,
   * and it is the difference between a picker that offers 19:30 and one that
   * offers 19:30 when 19:30 exists.
   *
   * `free_slots` returns times and nothing else - no names, no counts. The
   * guest book stays unreadable to this key.
   */
  useEffect(() => {
    if (!selected) {
      setFree(null);
      return;
    }
    let current = true;
    setCheckingSlots(true);

    (async () => {
      const { data, error } = await getDb().rpc('free_slots', {
        on_date: selected.date,
        party: partySize,
        candidates: selected.slots,
        wanted_area: area ?? null,
      });
      if (!current) return;
      // If the check itself fails, offer the scheduled times rather than an
      // empty picker - worst case the booking comes back as a request.
      // Postgres prints a `time` column with seconds ("19:00:00"); every slot
      // elsewhere on this page is "19:00", so trim to match rather than let
      // the one column sourced from the database look like a different field.
      setFree(error ? [...selected.slots] : (data ?? []).map((r: { slot: string }) => r.slot.slice(0, 5)));
      setCheckingSlots(false);
    })();

    return () => {
      current = false;
    };
  }, [selected, partySize, area]);

  // Dropping a day that stopped being offered - a blackout just added, say -
  // is better than holding a selection the reader can no longer see. Checked
  // against the date itself rather than the visible month, since paging the
  // calendar away from a chosen day must not look like losing it.
  useEffect(() => {
    if (date && blackouts && !availabilityFor({ isoDate: date, blackouts, today, windows }).bookable) {
      setDate('');
      setTime('');
    }
  }, [blackouts, date, today, windows]);

  const draft = { date, time, partySize, guestName, guestEmail, guestPhone, notes };
  const errors = validateBooking(draft);
  // Best guess from the last availability check, not a guarantee - a slot can
  // still turn either way between here and the actual submit.
  const isWaitlistPick = time !== '' && free !== null && !free.includes(time);

  // The key comes back from the validator, so the reason a field is wrong is
  // decided in one place rather than tested again here.
  function messageFor(field: keyof typeof errors): string | null {
    const key = errors[field];
    if (!key || !touched[field]) return null;
    return t(`errors.${key}`);
  }

  const longFormat = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const monthFormat = new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'long', year: 'numeric' });
  const weekdayFormat = new Intl.DateTimeFormat(LOCALE_TAG[locale], { weekday: 'short' });
  // 2024-01-01 is a Monday - a fixed reference week, formatted per locale, is
  // simpler than reasoning about `Date`'s own Sunday-first weekday numbering.
  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    weekdayFormat.format(new Date(2024, 0, 1 + i)),
  );
  // Monday-first, matching the admin's own calendars (Closures, Reservations).
  const leadingBlanks = Array.from({ length: (new Date(year, month, 1).getDay() + 6) % 7 });

  const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched({ date: true, time: true, partySize: true, guestName: true, guestEmail: true, guestPhone: true });
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setFailed(null);
    try {
      /*
       * Posted to our own route rather than straight to Postgres, even though
       * row-level security would allow the direct insert. The route is what can
       * hold the mail provider's key, so it is what can send the receipt.
       */
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          time,
          partySize,
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim(),
          guestPhone: guestPhone.trim() || undefined,
          notes: notes.trim() || undefined,
          locale,
          area,
        }),
      });

      // Being throttled is not a broken website, and telling somebody to try
      // again - which is what the generic failure says - is the one piece of
      // advice guaranteed not to work.
      if (response.status === 429) {
        setFailed(t('tooMany', { phone: VENUE.phone }));
        return;
      }
      if (!response.ok) throw new Error(String(response.status));

      // Whether the receipt actually sent changes what we promise on the next
      // screen. Nothing has gone wrong for the guest either way.
      const result = (await response.json()) as { emailed?: boolean; confirmed?: boolean };
      setEmailed(result.emailed !== false);
      setConfirmed(result.confirmed === true);
      setDone(true);
    } catch {
      setFailed(t('failed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <section className="mx-auto max-w-xl px-5 py-24 text-center">
        <p className="text-[0.68rem] uppercase tracking-[0.3em] text-[var(--accent)]">
          {t(confirmed ? 'confirmedEyebrow' : 'successEyebrow')}
        </p>
        <h1 className="mt-5 font-[family-name:var(--font-voces)] text-3xl">
          {t(confirmed ? 'confirmedHeading' : 'successHeading')}
        </h1>
        <p className="mt-5 leading-relaxed text-[var(--text-muted)]">
          {/* A confirmed table and a request are different promises. */}
          {t(confirmed ? 'confirmedBody' : emailed ? 'successBody' : 'successBodyNoEmail', {
            date: longFormat.format(asDate(date)),
            time,
            count: partySize,
          })}
        </p>
        <p className="mt-6 text-[0.85rem] leading-relaxed text-[var(--text-muted)]">
          {t('successNote', { phone: VENUE.phone })}
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-xl px-5 py-16 sm:py-24">
      <p className="text-[0.68rem] uppercase tracking-[0.3em] text-[var(--accent)]">
        {t('eyebrow')}
      </p>
      <h1 className="mt-5 font-[family-name:var(--font-voces)] text-4xl">{t('heading')}</h1>
      <p className="mt-5 leading-relaxed text-[var(--text-muted)]">{t('body')}</p>

      <form onSubmit={submit} noValidate className="mt-12 flex flex-col gap-10">
        <fieldset>
          <legend className="text-[0.72rem] uppercase tracking-[0.2em]">{t('partyLabel')}</legend>
          <div className="mt-4 flex flex-wrap gap-2">
            {PARTY_SIZES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPartySize(n)}
                aria-pressed={partySize === n}
                className={`h-11 w-11 border text-[0.9rem] transition-colors ${
                  partySize === n
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--color-paper)]'
                    : 'border-[var(--surface-edge)] hover:border-[var(--accent)]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[0.8rem] text-[var(--text-muted)]">
            {t('partyNote', { max: MAX_PARTY_ONLINE, email: VENUE.email })}
          </p>
        </fieldset>

        <fieldset>
          <legend className="text-[0.72rem] uppercase tracking-[0.2em]">{t('areaLabel')}</legend>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setArea(undefined)}
              aria-pressed={area === undefined}
              className={`border px-3.5 py-2 text-[0.85rem] transition-colors ${
                area === undefined
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--color-paper)]'
                  : 'border-[var(--surface-edge)] hover:border-[var(--accent)]'
              }`}
            >
              {t('areaAny')}
            </button>
            {AREAS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setArea(a)}
                aria-pressed={area === a}
                className={`border px-3.5 py-2 text-[0.85rem] transition-colors ${
                  area === a
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--color-paper)]'
                    : 'border-[var(--surface-edge)] hover:border-[var(--accent)]'
                }`}
              >
                {t(`area.${a}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[0.72rem] uppercase tracking-[0.2em]">{t('dateLabel')}</legend>

          {blackouts === null ? (
            <p className="mt-4 text-[0.85rem] text-[var(--text-muted)]">{t('loading')}</p>
          ) : (
            <div className="mt-4 max-w-xs">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => shiftMonth(m, -1))}
                  disabled={atFirstMonth}
                  aria-label={t('previousMonth')}
                  className="flex h-9 w-9 items-center justify-center border border-[var(--surface-edge)] transition-colors hover:border-[var(--accent)] disabled:opacity-30 disabled:hover:border-[var(--surface-edge)]"
                >
                  ←
                </button>
                <p className="text-[0.85rem] font-medium">{monthFormat.format(viewMonth)}</p>
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => shiftMonth(m, 1))}
                  disabled={atLastMonth}
                  aria-label={t('nextMonth')}
                  className="flex h-9 w-9 items-center justify-center border border-[var(--surface-edge)] transition-colors hover:border-[var(--accent)] disabled:opacity-30 disabled:hover:border-[var(--surface-edge)]"
                >
                  →
                </button>
              </div>

              <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[0.66rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                {weekdayLabels.map((label, i) => (
                  <span key={i}>{label}</span>
                ))}
              </div>

              <div className="mt-1 grid grid-cols-7 gap-1">
                {leadingBlanks.map((_, i) => (
                  <span key={`blank-${i}`} aria-hidden="true" />
                ))}
                {monthDays.map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    disabled={!d.bookable}
                    onClick={() => {
                      setDate(d.date);
                      setTime('');
                      setTouched((p) => ({ ...p, date: true }));
                    }}
                    aria-pressed={date === d.date}
                    title={!d.bookable && d.reason === 'blocked' ? d.blockedBy : undefined}
                    className={`flex h-10 items-center justify-center border text-[0.85rem] tabular-nums transition-colors ${
                      date === d.date
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--color-paper)]'
                        : d.bookable
                          ? 'border-[var(--surface-edge)] hover:border-[var(--accent)]'
                          : 'border-transparent text-[var(--text-muted)] opacity-40'
                    }`}
                  >
                    {Number(d.date.slice(-2))}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loadError && (
            <p className="mt-3 text-[0.8rem] text-[var(--text-muted)]">{t('blackoutsUnavailable')}</p>
          )}
          {messageFor('date') && (
            <p className="mt-3 text-[0.8rem] text-[var(--accent)]">{messageFor('date')}</p>
          )}
        </fieldset>

        {selected && (
          <fieldset>
            <legend className="text-[0.72rem] uppercase tracking-[0.2em]">{t('timeLabel')}</legend>
            {checkingSlots && free === null ? (
              <p className="mt-4 text-[0.85rem] text-[var(--text-muted)]">{t('checkingTimes')}</p>
            ) : (
            <>
            {free !== null && free.length < selected.slots.length && (
              <p className="mt-4 flex items-center gap-1.5 text-[0.8rem] text-[var(--text-muted)]">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: 'color-mix(in oklab, var(--danger) 45%, transparent)' }}
                />
                {t('waitlistLegend')}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {/* Every scheduled time is always offered, not just the free
                  ones - picking a full one still sends a request, it just
                  reads as a waitlist ask rather than an instant table. */}
              {selected.slots.map((slot) => {
                const isFree = free === null || free.includes(slot);
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => {
                      setTime(slot);
                      setTouched((p) => ({ ...p, time: true }));
                    }}
                    aria-pressed={time === slot}
                    style={
                      time !== slot && !isFree
                        ? {
                            background: 'color-mix(in oklab, var(--danger) 10%, transparent)',
                            borderColor: 'color-mix(in oklab, var(--danger) 40%, transparent)',
                          }
                        : undefined
                    }
                    className={`border px-3.5 py-2 text-[0.85rem] transition-colors ${
                      time === slot
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--color-paper)]'
                        : 'border-[var(--surface-edge)] hover:border-[var(--accent)]'
                    }`}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
            </>
            )}
            {messageFor('time') && (
              <p className="mt-3 text-[0.8rem] text-[var(--accent)]">{messageFor('time')}</p>
            )}
          </fieldset>
        )}

        {/*
          `maxLength` throughout, matching FIELD_LIMITS. The browser simply
          stops accepting characters, which is a better answer than letting
          somebody write six hundred words about their allergies and then
          telling them it was too much. The validator still carries the same
          rule, because the form is not the only thing that can post.
        */}
        <div className="flex flex-col gap-6">
          <Field
            id="name"
            label={t('nameLabel')}
            value={guestName}
            onChange={setGuestName}
            onBlur={() => setTouched((p) => ({ ...p, guestName: true }))}
            error={messageFor('guestName')}
            autoComplete="name"
            maxLength={FIELD_LIMITS.guestName}
          />
          <Field
            id="email"
            type="email"
            label={t('emailLabel')}
            value={guestEmail}
            onChange={setGuestEmail}
            onBlur={() => setTouched((p) => ({ ...p, guestEmail: true }))}
            error={messageFor('guestEmail')}
            autoComplete="email"
            maxLength={FIELD_LIMITS.guestEmail}
          />
          <Field
            id="phone"
            type="tel"
            label={t('phoneLabel')}
            value={guestPhone}
            onChange={setGuestPhone}
            onBlur={() => setTouched((p) => ({ ...p, guestPhone: true }))}
            error={messageFor('guestPhone')}
            autoComplete="tel"
            hint={t('phoneHint')}
            maxLength={FIELD_LIMITS.guestPhone}
          />

          <label className="flex flex-col gap-2">
            <span className="text-[0.72rem] uppercase tracking-[0.2em]">{t('notesLabel')}</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, notes: true }))}
              rows={3}
              maxLength={FIELD_LIMITS.notes}
              placeholder={t('notesPlaceholder')}
              aria-invalid={messageFor('notes') ? true : undefined}
              className={`border bg-transparent px-3 py-2.5 text-[0.95rem] outline-none focus:border-[var(--accent)] ${
                messageFor('notes') ? 'border-[var(--accent)]' : 'border-[var(--surface-edge)]'
              }`}
            />
            {messageFor('notes') && (
              <span className="text-[0.8rem] text-[var(--accent)]">{messageFor('notes')}</span>
            )}
          </label>
        </div>

        {failed && <p className="text-[0.85rem] text-[var(--accent)]">{failed}</p>}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-[var(--text)] px-6 py-4 text-[0.75rem] uppercase tracking-[0.2em] text-[var(--surface)] transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
          >
            {submitting ? t('submitting') : isWaitlistPick ? t('submitWaitlist') : t('submit')}
          </button>
          <p className="mt-4 text-[0.8rem] leading-relaxed text-[var(--text-muted)]">
            {t('requestNoteAuto')}
          </p>
        </div>
      </form>
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
