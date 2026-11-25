'use client';

import { useState } from 'react';
import { setBookingStatus } from '@tannin/supabase';
import type { BookingStatus } from '@tannin/core';
import { getDb } from '@/lib/supabase';

/** Status shown as a chip, not text weight - readable at a glance rather than up close. */
export const STATUS_CHIP: Record<BookingStatus, string> = {
  pending: 'chip-pending',
  confirmed: 'chip-on',
  seated: 'chip-muted',
  cancelled: 'chip-off',
  no_show: 'chip-off',
};

/** Bookings that are done-with, dimmed rather than struck through - still legible, clearly settled. */
export const SETTLED_STATUSES: BookingStatus[] = ['cancelled', 'no_show'];

export const NEXT_BOOKING_STATUSES: Record<BookingStatus, { label: string; to: BookingStatus }[]> = {
  pending: [
    { label: 'Confirm', to: 'confirmed' },
    { label: 'Decline', to: 'cancelled' },
  ],
  confirmed: [
    { label: 'Seated', to: 'seated' },
    { label: 'Cancelled', to: 'cancelled' },
    { label: 'No show', to: 'no_show' },
  ],
  seated: [{ label: 'Undo', to: 'confirmed' }],
  cancelled: [{ label: 'Reinstate', to: 'confirmed' }],
  no_show: [{ label: 'Undo', to: 'confirmed' }],
};

/**
 * Confirm / Seated / Cancelled / No show for one booking, plus the guest
 * email that follows a confirm or a cancel - the actions Tonight's board
 * always had, factored out so Reservations and the Day plan offer the same
 * ones instead of only being able to glance at a status somebody else set.
 *
 * `onNotice`/`onError` are optional escape hatches for a caller that already
 * has its own banner (Tonight's board does) - leave them out and this shows
 * the result inline next to the buttons instead.
 */
export function BookingStatusActions({
  id,
  status,
  onChanged,
  onNotice,
  onError,
  className = '',
}: {
  id: string;
  status: BookingStatus;
  onChanged: (status: BookingStatus) => void;
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function move(to: BookingStatus) {
    setBusy(true);
    setLocalError(null);
    setLocalNotice(null);
    try {
      await setBookingStatus(getDb(), id, to);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save that.';
      if (onError) onError(message);
      else setLocalError(message);
      setBusy(false);
      return;
    }
    onChanged(to);

    // Only these two are worth telling a guest about. Seated and no-show are
    // recorded for the room, not announced to the person.
    if (to !== 'confirmed' && to !== 'cancelled') {
      setBusy(false);
      return;
    }

    let message: string;
    try {
      const { data } = await getDb().auth.getSession();
      const response = await fetch('/api/bookings/notify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${data.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ id, status: to }),
      });
      const result = (await response.json()) as { sent?: boolean; reason?: string };
      message = result.sent
        ? to === 'confirmed'
          ? 'Guest emailed.'
          : 'Guest told.'
        : result.reason === 'not-configured'
          ? 'Saved - but no email was sent, because mail is not set up yet.'
          : 'Saved - but the email did not send. Worth calling them.';
    } catch {
      // The status change is what mattered and it already happened.
      message = 'Saved - but the email did not send. Worth calling them.';
    }
    if (onNotice) onNotice(message);
    else setLocalNotice(message);
    setBusy(false);
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {NEXT_BOOKING_STATUSES[status].map((action) => (
        <button
          key={action.to}
          onClick={() => move(action.to)}
          disabled={busy}
          className={`btn ${action.to === 'confirmed' && status === 'pending' ? 'btn-primary' : 'btn-quiet'}`}
        >
          {action.label}
        </button>
      ))}
      {!onNotice && localNotice && <span className="text-[0.78rem] text-[var(--text-muted)]">{localNotice}</span>}
      {!onError && localError && <span className="text-[0.78rem] text-[var(--danger)]">{localError}</span>}
    </div>
  );
}
