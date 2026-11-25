'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getDb } from '@/lib/supabase';

type ToastKind = 'new' | 'cancelled';

interface Toast {
  /** `${kind}:${bookingId}` - a booking can produce one of each, never two of one. */
  key: string;
  kind: ToastKind;
  guestName: string;
  date: string;
  time: string;
  partySize: number;
}

interface BookingRow {
  id: string;
  guest_name: string;
  date: string;
  time: string;
  party_size: number;
  status?: string;
  cancelled_by?: string | null;
}

const AUTO_DISMISS_MS = 10_000;

const COPY: Record<ToastKind, { title: string; verb: string }> = {
  new: { title: 'New booking', verb: 'booked' },
  cancelled: { title: 'Table freed', verb: 'cancelled' },
};

/**
 * Bookings landing - and guests dropping out - live, on whatever screen staff
 * happen to be standing on.
 *
 * Mounted once, in `AuthGate`, for anyone with the `tables` permission - the
 * same gate the floor plan itself uses. Row-level security already decided
 * this person may read `bookings`; Realtime enforces that same policy against
 * their session, so subscribing is all this does - there is nothing extra to
 * check here.
 *
 * Two events, not one. An INSERT is a fresh request. An UPDATE only earns a
 * toast when it is a guest cancelling themselves - `cancelled_by = 'guest'` -
 * because a staff member changing a status from the board does not need telling
 * about the change they just made, and every table assignment is an UPDATE too.
 */
export function BookingNotifier() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  function dismiss(key: string) {
    setToasts((prev) => prev.filter((t) => t.key !== key));
    const timer = timers.current.get(key);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(key);
    }
  }

  useEffect(() => {
    const push = (kind: ToastKind, row: BookingRow) => {
      const key = `${kind}:${row.id}`;
      const toast: Toast = {
        key,
        kind,
        guestName: row.guest_name,
        date: row.date,
        time: row.time,
        partySize: row.party_size,
      };
      setToasts((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, toast]));
      timers.current.set(
        key,
        setTimeout(() => dismiss(key), AUTO_DISMISS_MS),
      );
    };

    const db = getDb();
    const channel = db
      .channel('bookings-activity')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bookings' },
        (payload) => {
          const row = payload.new as BookingRow;
          // Only a request that still needs a decision earns a toast. A booking
          // that inserted already 'confirmed' - a website booking that fit, or a
          // phone booking staff just took - is done; nobody needs pushing at
          // about it, least of all the staffer who entered it themselves.
          if (row.status === 'pending') push('new', row);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bookings' },
        (payload) => {
          const row = payload.new as BookingRow;
          // The only status change staff want pushed at them: a guest freeing
          // their own table. Their own board actions, and every seating tweak,
          // are UPDATEs too - none of those belong here.
          if (row.status === 'cancelled' && row.cancelled_by === 'guest') {
            push('cancelled', row);
          }
        },
      )
      .subscribe();

    const activeTimers = timers.current;
    return () => {
      db.removeChannel(channel);
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className="toast">
          <p className="toast-title">{COPY[t.kind].title}</p>
          <p className="toast-body">
            {t.guestName} · {t.time.slice(0, 5)} · {t.partySize}
          </p>
          <div className="toast-actions">
            <Link
              href={`/bookings?date=${t.date}`}
              className="btn btn-primary"
              onClick={() => dismiss(t.key)}
            >
              Open
            </Link>
            <button onClick={() => dismiss(t.key)} className="btn btn-quiet">
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
