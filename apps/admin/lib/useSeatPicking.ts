'use client';

import { useState } from 'react';
import { condensedSeatOrder } from './floorGeometry';
import type { FloorTable } from './floorGeometry';

export interface SeatPick {
  selectedTable: string | null;
  selectedSeats: number[];
  joinedTableIds: string[];
  joining: boolean;
  setSelectedTable: (id: string | null) => void;
  setSelectedSeats: (seats: number[]) => void;
  setJoinedTableIds: (ids: string[]) => void;
  setJoining: (v: boolean) => void;
  isTaken: (tableId: string, seatIndex: number) => boolean;
  isFullyFree: (tableId: string) => boolean;
  clickTableBody: (t: Pick<FloorTable, 'id' | 'seats' | 'one_row' | 'ends' | 'vertical'>) => void;
  clickSeat: (tableId: string, seatIndex: number) => void;
  /** Back to blank, or to a specific starting pick (e.g. where a booking already sits). */
  reset: (preset?: { tableId: string; seats: number[]; joinedTableIds?: string[] }) => void;
}

/**
 * The click rules for manually seating a party on the floor plan: tap a
 * table's body to fill it in one go, tap chairs one at a time, or join a
 * further table for a party too big for one alone.
 *
 * Shared by the seat picker (a new booking, or one with no table yet) and the
 * Day plan's in-place "seat elsewhere" mode (an existing booking) - both used
 * to hand-roll this same ~80 lines separately, which is exactly the kind of
 * thing that quietly drifts: one gets a fix the other doesn't, and staff see
 * two "floor plans" that behave differently for what is, to a guest, the
 * same action of pointing at a chair.
 */
export function useSeatPicking(occupied: Map<string, Set<number> | 'all'>, partySize: number): SeatPick {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [joinedTableIds, setJoinedTableIds] = useState<string[]>([]);
  const [joining, setJoining] = useState(false);

  function isTaken(tableId: string, seatIndex: number): boolean {
    const o = occupied.get(tableId);
    if (o === 'all') return true;
    return o?.has(seatIndex) ?? false;
  }

  /** A table is joinable only if it's holding nobody at all right now - it gets claimed whole. */
  function isFullyFree(tableId: string): boolean {
    const o = occupied.get(tableId);
    return o !== 'all' && (o?.size ?? 0) === 0;
  }

  function clickTableBody(t: Pick<FloorTable, 'id' | 'seats' | 'one_row' | 'ends' | 'vertical'>) {
    if (joining) {
      if (t.id === selectedTable || joinedTableIds.includes(t.id) || !isFullyFree(t.id)) return;
      setJoinedTableIds([...joinedTableIds, t.id]);
      setJoining(false);
      return;
    }
    if (joinedTableIds.includes(t.id)) {
      setJoinedTableIds(joinedTableIds.filter((id) => id !== t.id));
      return;
    }
    const blocked = occupied.get(t.id);
    if (blocked === 'all') return;
    const already = selectedTable === t.id ? selectedSeats : [];
    const seats = [...already];
    for (const i of condensedSeatOrder(t)) {
      if (seats.length >= partySize) break;
      if (seats.includes(i) || blocked?.has(i)) continue;
      seats.push(i);
    }
    setSelectedTable(t.id);
    setSelectedSeats(seats);
    if (selectedTable !== t.id) setJoinedTableIds([]);
  }

  function clickSeat(tableId: string, seatIndex: number) {
    if (joining) {
      if (tableId === selectedTable || joinedTableIds.includes(tableId) || !isFullyFree(tableId)) return;
      setJoinedTableIds([...joinedTableIds, tableId]);
      setJoining(false);
      return;
    }
    if (joinedTableIds.includes(tableId)) {
      setJoinedTableIds(joinedTableIds.filter((id) => id !== tableId));
      return;
    }
    if (isTaken(tableId, seatIndex)) return;
    if (selectedTable !== tableId) {
      setSelectedTable(tableId);
      setSelectedSeats([seatIndex]);
      setJoinedTableIds([]); // a new primary table invalidates whatever was joined to the old one
      return;
    }
    if (selectedSeats.includes(seatIndex)) {
      setSelectedSeats(selectedSeats.filter((i) => i !== seatIndex));
      return;
    }
    if (selectedSeats.length >= partySize) return; // full - deselect one first
    setSelectedSeats([...selectedSeats, seatIndex]);
  }

  function reset(preset?: { tableId: string; seats: number[]; joinedTableIds?: string[] }) {
    setSelectedTable(preset?.tableId ?? null);
    setSelectedSeats(preset?.seats ?? []);
    setJoinedTableIds(preset?.joinedTableIds ?? []);
    setJoining(false);
  }

  return {
    selectedTable,
    selectedSeats,
    joinedTableIds,
    joining,
    setSelectedTable,
    setSelectedSeats,
    setJoinedTableIds,
    setJoining,
    isTaken,
    isFullyFree,
    clickTableBody,
    clickSeat,
    reset,
  };
}
