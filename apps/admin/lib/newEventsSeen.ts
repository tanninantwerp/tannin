/**
 * When this device last opened Today or Reservations, for the "new events"
 * badge on the hub.
 *
 * Per-device and per-screen, deliberately: two people behind the same bar on
 * two different phones each get their own count, and glancing at Today does
 * not clear Reservations' badge or vice versa. A device's first-ever read
 * seeds "now" rather than "the start of time" - otherwise the first person to
 * open this on a fresh phone would see every request the room has ever had.
 */

export type EventsScope = 'today' | 'reservations';

function storageKey(scope: EventsScope): string {
  return `tannin-admin-events-seen-${scope}`;
}

export function getLastSeen(scope: EventsScope): string {
  if (typeof window === 'undefined') return new Date().toISOString();
  const key = storageKey(scope);
  const stored = window.localStorage.getItem(key);
  if (stored) return stored;
  const now = new Date().toISOString();
  window.localStorage.setItem(key, now);
  return now;
}

export function markSeen(scope: EventsScope): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(scope), new Date().toISOString());
}
