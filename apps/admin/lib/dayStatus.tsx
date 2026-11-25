import type { SupabaseClient } from '@supabase/supabase-js';
import { availabilityFor } from '@tannin/core';
import type { Blackout, BookingArea } from '@tannin/core';
import { fetchAreaClosures } from '@tannin/supabase';
import type { AreaClosure } from '@tannin/supabase';

/**
 * One day's status - closed, full, or somewhere between - shared by the
 * Reservations calendar (a whole month of these, probed in a batch) and
 * Tonight's board (just the one date it's showing). Neither guesses: closed
 * comes from `blackouts`/`area_closures`, full comes from the real table
 * plan via `free_slots`.
 */

export const AREAS: BookingArea[] = ['inside', 'terrace', 'bar'];
export const AREA_LABEL: Record<BookingArea, string> = { inside: 'Inside', terrace: 'Terrace', bar: 'Bar' };

export type DotState = 'open' | 'closed' | 'closed-half' | 'full' | 'full-half';

export interface DayStatus {
  state: DotState;
  closedAreas: readonly BookingArea[];
  fullAreas: readonly BookingArea[];
  /** Why: a blackout note, or the reason(s) behind whichever areas are closed. */
  closedReason?: string;
}

export function StatusDot({ state }: { state: DotState }) {
  return <span className={`status-dot status-dot-${state}`} aria-hidden="true" />;
}

/** Same states, applied as a cell or banner background instead of a small swatch. */
export function dayCellClass(state: DotState): string {
  return `day-${state}`;
}

export function statusLabel(status: DayStatus): string {
  switch (status.state) {
    case 'closed':
      return 'Closed';
    case 'closed-half':
      return `${status.closedAreas.map((a) => AREA_LABEL[a]).join(' & ')} closed`;
    case 'full':
      return 'Fully booked';
    case 'full-half':
      return `${status.fullAreas.map((a) => AREA_LABEL[a]).join(' & ')} full`;
    default:
      return 'Open';
  }
}

export function closedAreasForDate(iso: string, areaClosures: readonly AreaClosure[]): BookingArea[] {
  return AREAS.filter((area) => areaClosures.some((c) => c.area === area && c.fromDate <= iso && c.toDate >= iso));
}

/**
 * Which of the given (already-open) areas have no room left for a party of
 * two - the venue's most common booking, and a reasonable stand-in for "can
 * a typical guest still get in," not an exhaustive check across every party
 * size. One `free_slots` round trip per area, in parallel.
 */
export async function fullAreasForDate(
  db: SupabaseClient,
  iso: string,
  openAreas: readonly BookingArea[],
  candidates: readonly string[],
): Promise<BookingArea[]> {
  const results = await Promise.all(
    openAreas.map(async (area) => {
      const { data, error } = await db.rpc('free_slots', {
        on_date: iso,
        party: 2,
        candidates,
        wanted_area: area,
      });
      if (error) throw error;
      return [area, (data ?? []).length === 0] as const;
    }),
  );
  return results.filter(([, isFull]) => isFull).map(([area]) => area);
}

export function statusFromParts(
  blackouts: readonly Blackout[],
  areaClosures: readonly AreaClosure[],
  iso: string,
  fullAreas: readonly BookingArea[],
): DayStatus {
  const wholeBlackout = blackouts.find((b) => b.date === iso && !b.from);
  if (wholeBlackout) {
    return { state: 'closed', closedAreas: AREAS, fullAreas: [], closedReason: wholeBlackout.reason };
  }

  const closures = areaClosures.filter((c) => c.fromDate <= iso && c.toDate >= iso);
  const closedAreas = AREAS.filter((a) => closures.some((c) => c.area === a));
  const closedReason = closures.map((c) => `${AREA_LABEL[c.area]} - ${c.reason}`).join('; ') || undefined;

  if (closedAreas.length >= AREAS.length) return { state: 'closed', closedAreas, fullAreas: [], closedReason };
  if (closedAreas.length > 0) return { state: 'closed-half', closedAreas, fullAreas: [], closedReason };
  if (fullAreas.length >= AREAS.length) return { state: 'full', closedAreas: [], fullAreas };
  if (fullAreas.length > 0) return { state: 'full-half', closedAreas: [], fullAreas };
  return { state: 'open', closedAreas: [], fullAreas: [] };
}

/** Full status for exactly one date, in one go - what Tonight's board banner shows. */
export async function fetchDayStatus(db: SupabaseClient, iso: string): Promise<DayStatus> {
  const [blackoutRes, areaClosures] = await Promise.all([
    db.from('blackouts').select('id, date, reason, from, to').eq('date', iso),
    fetchAreaClosures(db),
  ]);
  if (blackoutRes.error) throw blackoutRes.error;
  const blackouts = (blackoutRes.data ?? []) as Blackout[];

  const withoutFullness = statusFromParts(blackouts, areaClosures, iso, []);
  if (withoutFullness.state !== 'open') return withoutFullness;

  const av = availabilityFor({ isoDate: iso, blackouts });
  if (!av.bookable || av.slots.length === 0) return withoutFullness;

  const full = await fullAreasForDate(db, iso, AREAS, av.slots);
  return statusFromParts(blackouts, areaClosures, iso, full);
}
