import { condensedSeatOrder } from './floorGeometry';
import type { FloorTable } from './floorGeometry';

/** The shape both SeatPicker and the Day plan's reseat mode read bookings as. */
export interface OccupancyBooking {
  id: string;
  table_id: string | null;
  joined_table_ids: string[];
  seat_indices: number[] | null;
  party_size: number;
  time: string;
}

/** The same knobs `party_turn()`/`reset_buffer()` read from `booking_settings` in the DB. */
export interface TurnSettings {
  turnMinutes: number;
  turnMinutesLarge: number | null;
  largePartyThreshold: number;
  bufferMinutes: number;
}

export const DEFAULT_TURN_SETTINGS: TurnSettings = {
  turnMinutes: 105,
  turnMinutesLarge: null,
  largePartyThreshold: 5,
  bufferMinutes: 0,
};

/** Mirrors the DB's `party_turn(party)`: a big party gets the long turn, everyone else the normal one. */
function partyTurn(party: number, s: TurnSettings): number {
  return party >= s.largePartyThreshold ? (s.turnMinutesLarge ?? s.turnMinutes) : s.turnMinutes;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(':');
  return Number(h) * 60 + Number(m);
}

function overlaps(aStart: number, aTurn: number, bStart: number, bTurn: number): boolean {
  return aStart < bStart + bTurn && bStart < aStart + aTurn;
}

/**
 * Table id → occupied seat indices, or 'all' if any overlapping booking holds
 * the whole table - at one specific time, not a glance across the whole day.
 *
 * Each booking's own window is sized by its own party - a party at or past
 * `largePartyThreshold` blocks the table for `turnMinutesLarge`, same as
 * `allocate()` uses when it decides whether a table is free - and every
 * existing booking's window carries the reset buffer on top, matching
 * `table_has_room`. Without this, the seat picker could show a table as free
 * a few minutes before the allocator itself would actually confirm it there.
 *
 * Shared by SeatPicker and the Day plan's in-place reseat mode so the two
 * never drift into disagreeing about what's actually free at a given moment.
 */
export function computeOccupied(
  bookings: OccupancyBooking[],
  tables: Pick<FloorTable, 'id' | 'seats' | 'is_shared' | 'one_row' | 'ends' | 'vertical'>[],
  atTime: string,
  candidatePartySize: number,
  settings: TurnSettings,
  excludeBookingId?: string,
): Map<string, Set<number> | 'all'> {
  const start = toMinutes(atTime);
  const candidateTurn = partyTurn(candidatePartySize, settings);
  const isShared = new Map(tables.map((t) => [t.id, t.is_shared]));
  const seatsOf = new Map(tables.map((t) => [t.id, t.seats]));

  // Two passes: first collect every overlapping claim per table (a picked
  // set of chairs, or just a headcount), then turn that into taken seats -
  // a shared table needs every claim in hand before it can say how many
  // chairs are actually spoken for, rather than going 'all' the moment it
  // holds anybody.
  const claims = new Map<string, { seatIndices: number[] | null; count: number }[]>();
  function addClaim(tableId: string, seatIndices: number[] | null, count: number) {
    const list = claims.get(tableId) ?? [];
    list.push({ seatIndices, count });
    claims.set(tableId, list);
  }
  for (const b of bookings) {
    if (b.id === excludeBookingId) continue;
    const bTurn = partyTurn(b.party_size, settings) + settings.bufferMinutes;
    if (!overlaps(start, candidateTurn, toMinutes(b.time), bTurn)) continue;
    // The joined tables (if any) are each held in full - seat_indices, when
    // set, only describes chairs on the primary table. Joined tables are
    // never shared, so each resolves to 'all' below.
    b.joined_table_ids.forEach((jid) => addClaim(jid, null, seatsOf.get(jid) ?? 0));
    if (b.table_id) addClaim(b.table_id, b.seat_indices, b.party_size);
  }

  const map = new Map<string, Set<number> | 'all'>();
  for (const [tableId, list] of claims) {
    if (!isShared.get(tableId)) {
      if (list.some((c) => !c.seatIndices || c.seatIndices.length === 0)) {
        map.set(tableId, 'all');
        continue;
      }
      const set = new Set<number>();
      list.forEach((c) => c.seatIndices!.forEach((i) => set.add(i)));
      map.set(tableId, set);
      continue;
    }
    // Shared: chairs explicitly picked are claimed exactly; every other
    // claim just takes that many of whatever's left - book_table never
    // picks specific chairs, so a count is all there is to show.
    const set = new Set<number>();
    let auto = 0;
    list.forEach((c) => {
      if (c.seatIndices && c.seatIndices.length > 0) c.seatIndices.forEach((i) => set.add(i));
      else auto += c.count;
    });
    const t = tables.find((x) => x.id === tableId);
    for (const i of t ? condensedSeatOrder(t) : []) {
      if (auto <= 0) break;
      if (!set.has(i)) {
        set.add(i);
        auto--;
      }
    }
    map.set(tableId, set);
  }
  return map;
}
