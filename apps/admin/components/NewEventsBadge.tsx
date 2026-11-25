'use client';

import { useEffect, useState } from 'react';
import { fetchNewEventDates } from '@tannin/supabase';
import { toISODate } from '@tannin/core';
import { getDb } from '@/lib/supabase';
import { getLastSeen, type EventsScope } from '@/lib/newEventsSeen';

/**
 * A red flag on a hub tile: something landed here since this device last
 * looked - a new request, a guest cancelling, a waitlist ask. Distinct from
 * `PendingBadge`'s running "N waiting" count in the header, which never goes
 * to zero as long as anything is undecided: this one is per-device, resets
 * the moment the tile's own screen is opened (see `newEventsSeen`), and
 * exists purely to catch the eye on the hub before anyone has tapped in.
 *
 * Today's tile counts only today's events; Reservations' counts every date,
 * matching the per-date dots on its own calendar.
 */
export function NewEventsBadge({ scope }: { scope: EventsScope }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const db = getDb();
    const since = getLastSeen(scope);

    const refresh = () => {
      fetchNewEventDates(db, since)
        .then((dates) => {
          if (cancelled) return;
          const todayISO = toISODate(new Date());
          setCount(scope === 'today' ? dates.filter((d) => d === todayISO).length : dates.length);
        })
        .catch(() => {});
    };

    refresh();
    const channel = db
      .channel(`new-events-${scope}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_changes' }, refresh)
      .subscribe();

    return () => {
      cancelled = true;
      db.removeChannel(channel);
    };
  }, [scope]);

  if (count === 0) return null;

  return (
    <span
      role="status"
      aria-label={`${count} new event${count === 1 ? '' : 's'} since this was last opened`}
      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center"
    >
      {/* Base down, point up - a red triangle so this reads as an alert, not just a count. */}
      <svg viewBox="0 0 22 20" aria-hidden="true" className="absolute inset-0 h-full w-full drop-shadow-sm">
        <path d="M11 0L22 20H0Z" fill="var(--danger)" />
      </svg>
      <span className="relative mt-2 text-[0.62rem] font-bold leading-none text-[var(--color-paper)]">
        {count > 9 ? '9+' : count}
      </span>
    </span>
  );
}
