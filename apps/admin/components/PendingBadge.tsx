'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { countPendingBookings, fetchClosestPendingDate } from '@tannin/supabase';
import { toISODate } from '@tannin/core';
import { getDb } from '@/lib/supabase';

/**
 * A standing count of requests still waiting on a decision.
 *
 * The live toast (BookingNotifier) only catches a request if someone is looking
 * when it lands. This is the other half: a number in the header of every
 * screen, there on load, so a request that arrived overnight - while the admin
 * was closed - is obvious the moment anyone opens it, not buried on a day
 * nobody thought to page to.
 *
 * Fetched once, then kept honest by the same Realtime feed the notifier uses:
 * any change to `bookings` re-counts. It resolves the same way the board does -
 * a `head` count against row-level security - so it shows nothing it should not.
 *
 * Links straight to the soonest pending request's own date rather than always
 * to today - a request three days out should not require paging forward by
 * hand to find it.
 */
export function PendingBadge() {
  const [count, setCount] = useState(0);
  const [closestDate, setClosestDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const db = getDb();

    const refresh = () => {
      const from = toISODate(new Date());
      Promise.all([countPendingBookings(db, from), fetchClosestPendingDate(db, from)])
        .then(([n, date]) => {
          if (!cancelled) {
            setCount(n);
            setClosestDate(date);
          }
        })
        // A failed count just leaves the badge as it was rather than throwing
        // an error into a header that is on every page.
        .catch(() => {});
    };

    refresh();
    const channel = db
      .channel('bookings-pending')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, refresh)
      .subscribe();

    return () => {
      cancelled = true;
      db.removeChannel(channel);
    };
  }, []);

  if (count === 0) return null;

  return (
    <Link
      href={closestDate ? `/bookings?date=${closestDate}` : '/bookings'}
      className="chip chip-alert min-h-11 items-center px-3"
      aria-label={`${count} booking request${count === 1 ? '' : 's'} waiting for a decision`}
    >
      {count} waiting
    </Link>
  );
}
