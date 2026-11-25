'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addSeatsDeltaOverride, fetchDayOverrides, updateSeatsDeltaOverride } from '@tannin/supabase';
import type { TableDayOverride } from '@tannin/supabase';
import { getDb } from '@/lib/supabase';
import { VBH, VBW, ZONES, condensedSeatOrder, seatsRel } from '@/lib/floorGeometry';
import type { FloorTable } from '@/lib/floorGeometry';
import { computeOccupied, DEFAULT_TURN_SETTINGS } from '@/lib/occupancy';
import type { TurnSettings } from '@/lib/occupancy';
import { useSeatPicking } from '@/lib/useSeatPicking';
import { Dot, RingDot, SeatLegend, ZoneBackground } from '@/components/FloorMapChrome';

const TABLE_COLUMNS =
  'id, name, seats, min_seats, area, active, x, y, w, h, is_high, is_shared, vertical, one_row, flip_row, ends, connect_group';

/** A table's real seat count plus tonight's own chair added via override, if any. */
function withSeatsDelta(rows: FloorTable[], overrides: TableDayOverride[]): FloorTable[] {
  return rows.map((t) => {
    const delta = overrides.find((o) => o.kind === 'seats_delta' && o.tableId === t.id)?.seatsDelta ?? 0;
    return delta ? { ...t, seats: t.seats + delta } : t;
  });
}

interface OtherBooking {
  id: string;
  table_id: string | null;
  joined_table_ids: string[];
  seat_indices: number[] | null;
  party_size: number;
  time: string;
  status: string;
}

const ZONE_PADDING = 24;

/**
 * The floor plan, for picking exactly which chairs a party sits in.
 *
 * A table dropdown can only say which table; this is for the times that
 * matters - a party of two at Counter Bar, say, leaving two stools free for
 * whoever's next, rather than the whole four-seat counter reading as taken.
 * Seats already spoken for by another booking whose turn overlaps this one
 * are shown taken and cannot be clicked, whether that other booking picked
 * specific chairs or (being made before this existed, or by the website's
 * own auto-allocation) simply holds the whole table.
 *
 * Opens on an area choice rather than the whole room at once - three zones'
 * worth of tables and chairs on one small panel is too dense to read or tap
 * accurately, especially on a phone behind the bar.
 */
export function SeatPicker({
  bookingId,
  date,
  time,
  partySize,
  preferredArea,
  currentTableId,
  currentSeatIndices,
  currentJoinedTableIds,
  onAssign,
  onClose,
}: {
  bookingId: string;
  date: string;
  time: string;
  partySize: number;
  preferredArea?: string | null;
  /** Where this booking already sits, if anywhere - shown pre-picked so reseating starts from "here", not blank. */
  currentTableId?: string | null;
  currentSeatIndices?: number[] | null;
  currentJoinedTableIds?: string[] | null;
  onAssign: (tableId: string, seatIndices: number[], joinedTableIds: string[]) => void;
  onClose: () => void;
}) {
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [overrides, setOverrides] = useState<TableDayOverride[]>([]);
  const [others, setOthers] = useState<OtherBooking[]>([]);
  const [turnSettings, setTurnSettings] = useState<TurnSettings>(DEFAULT_TURN_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = getDb();
    const [t, b, s, o] = await Promise.all([
      db.from('dining_tables').select(TABLE_COLUMNS).eq('active', true),
      db
        .from('bookings')
        .select('id, table_id, joined_table_ids, seat_indices, party_size, time, status')
        .eq('date', date)
        .in('status', ['pending', 'confirmed', 'seated'])
        .neq('id', bookingId),
      db.from('booking_settings')
        .select('turn_minutes, turn_minutes_large, large_party_threshold, buffer_minutes')
        .maybeSingle(),
      fetchDayOverrides(db, date).catch(() => [] as TableDayOverride[]),
    ]);
    if (t.error) setError(t.error.message);
    else setTables(withSeatsDelta((t.data ?? []) as FloorTable[], o));
    if (!b.error) setOthers((b.data ?? []) as OtherBooking[]);
    if (s.data?.turn_minutes) {
      setTurnSettings({
        turnMinutes: s.data.turn_minutes as number,
        turnMinutesLarge: (s.data.turn_minutes_large as number | null) ?? null,
        largePartyThreshold: (s.data.large_party_threshold as number | null) ?? DEFAULT_TURN_SETTINGS.largePartyThreshold,
        bufferMinutes: (s.data.buffer_minutes as number | null) ?? DEFAULT_TURN_SETTINGS.bufferMinutes,
      });
    }
    setOverrides(o);
    setLoading(false);
  }, [date, bookingId]);

  useEffect(() => {
    let cancelled = false;
    load().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the floor plan.');
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  /** +1 or +2 chairs for the selected table, for tonight only - tops up an existing override rather than stacking a second one. */
  async function addChairs(n: 1 | 2) {
    if (!selectedTable) return;
    const existing = overrides.find((o) => o.kind === 'seats_delta' && o.tableId === selectedTable);
    try {
      if (existing) {
        await updateSeatsDeltaOverride(getDb(), existing.id, (existing.seatsDelta ?? 0) + n);
      } else {
        await addSeatsDeltaOverride(getDb(), { date, tableId: selectedTable, seatsDelta: n });
      }
      setNotice(`Added ${n} chair${n > 1 ? 's' : ''} - tap the table again to seat there.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add chairs.');
    }
  }

  /** Table id → occupied seat indices, or 'all' if any overlapping booking holds the whole table. */
  const occupied = useMemo(
    () => computeOccupied(others, tables, time, partySize, turnSettings, bookingId),
    [others, time, partySize, turnSettings, tables, bookingId],
  );

  const pick = useSeatPicking(occupied, partySize);
  const { selectedTable, selectedSeats, joinedTableIds, joining } = pick;

  // Jump straight to wherever this booking already sits, with its own seats
  // shown picked rather than blank - reseating starts from "here", and those
  // seats are free to click away since `others` (and so `occupied`) never
  // includes this booking's own claim. Runs once the floor plan is in and a
  // zone hasn't been chosen yet, so it never overwrites a manual pick.
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || !currentTableId || tables.length === 0 || area !== null) return;
    const t = tables.find((x) => x.id === currentTableId);
    if (!t) return;
    preselected.current = true;
    setArea(t.area);
    let seats: number[];
    if (currentSeatIndices && currentSeatIndices.length > 0) {
      seats = currentSeatIndices;
    } else if (t.is_shared) {
      const blocked = occupied.get(currentTableId);
      seats = [];
      for (const i of condensedSeatOrder(t)) {
        if (seats.length >= partySize) break;
        if (blocked !== 'all' && !blocked?.has(i)) seats.push(i);
      }
    } else {
      // No chairs recorded and the table isn't shared, so this booking holds
      // every seat on it (the same 'all' this picker shows for any other
      // booking like it) - show them all picked, so staff sees the true
      // state and can narrow it down to exactly the party size.
      seats = Array.from({ length: t.seats }, (_, i) => i);
    }
    pick.reset({ tableId: currentTableId, seats, joinedTableIds: currentJoinedTableIds ?? [] });
  }, [currentTableId, currentSeatIndices, currentJoinedTableIds, tables, occupied, partySize, area]);

  /** Free seats in an area right now, for the "which area has room" hint. */
  function freeSeatsIn(areaName: string): number {
    return tables
      .filter((t) => t.area === areaName)
      .reduce((sum, t) => {
        const o = occupied.get(t.id);
        if (o === 'all') return sum;
        const takenCount = o?.size ?? 0;
        return sum + Math.max(0, t.seats - takenCount);
      }, 0);
  }

  function chooseArea(a: string) {
    setArea(a);
    pick.reset();
  }

  const zone = ZONES.find((z) => z.area === area);
  const placed = tables.filter((t) => t.x != null && t.y != null && t.area === area);
  const joinedTables = tables.filter((t) => joinedTableIds.includes(t.id));
  const totalPicked = selectedSeats.length + joinedTables.reduce((sum, t) => sum + t.seats, 0);
  const canAssign = selectedTable != null && totalPicked >= partySize;
  const viewBox = zone
    ? `${zone.x - ZONE_PADDING} ${zone.y - ZONE_PADDING} ${zone.w + ZONE_PADDING * 2} ${zone.h + ZONE_PADDING * 2}`
    : `0 0 ${VBW} ${VBH}`;

  return (
    <div className="card mt-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {area
            ? `Pick ${partySize} seat${partySize === 1 ? '' : 's'} - ${area}`
            : `Pick ${partySize} seat${partySize === 1 ? '' : 's'} - choose an area`}
        </p>
        <button onClick={onClose} className="btn btn-quiet">
          Cancel
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
      {notice && <p className="mt-2 text-sm text-[var(--text-muted)]">{notice}</p>}

      {loading ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">One moment…</p>
      ) : !area ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {ZONES.map((z) => (
            <button
              key={z.area}
              onClick={() => chooseArea(z.area)}
              className={`btn ${z.area === preferredArea ? 'btn-primary' : 'btn-quiet'}`}
            >
              {z.label} · {freeSeatsIn(z.area)} free
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-center justify-between">
            <button onClick={() => setArea(null)} className="btn btn-quiet">
              ← Change area
            </button>
          </div>
          <SeatLegend
            items={[
              { swatch: <Dot color="var(--danger)" />, label: 'taken' },
              { swatch: <RingDot color="var(--select)" />, label: 'picked' },
              { swatch: <RingDot color="var(--accent)" />, label: 'free - tap to pick' },
            ]}
          />
          <div
            className="mt-2 overflow-x-auto rounded-lg border p-1"
            style={{ background: 'var(--surface)', borderColor: 'var(--surface-edge)' }}
          >
            <svg viewBox={viewBox} className="block h-auto w-full min-w-[320px]">
              <ZoneBackground zone={zone!} />

              {placed.map((t) => {
                const w = t.w ?? 74;
                const h = t.h ?? 62;
                const seats = seatsRel(t);
                const joinable =
                  joining && t.id !== selectedTable && !joinedTableIds.includes(t.id) && pick.isFullyFree(t.id);
                return (
                  <g key={t.id} transform={`translate(${t.x} ${t.y})`}>
                    {seats.map((s, i) => {
                      const taken = pick.isTaken(t.id, i);
                      const chosen =
                        (selectedTable === t.id && selectedSeats.includes(i)) || joinedTableIds.includes(t.id);
                      const clickable = joining ? joinable : !taken;
                      return (
                        <circle
                          key={i}
                          cx={s.cx}
                          cy={s.cy}
                          r={9}
                          style={{ cursor: clickable ? 'pointer' : 'not-allowed', pointerEvents: 'all' }}
                          fill={chosen ? 'var(--select)' : taken ? 'var(--danger)' : 'transparent'}
                          opacity={taken && !chosen ? 0.5 : joining && !joinable && !joinedTableIds.includes(t.id) ? 0.4 : 1}
                          stroke={chosen ? 'var(--select)' : taken ? 'var(--danger)' : 'var(--accent)'}
                          strokeWidth={chosen ? 2.5 : 1.4}
                          onClick={() => pick.clickSeat(t.id, i)}
                        />
                      );
                    })}
                    <rect
                      width={w}
                      height={h}
                      rx={9}
                      fill={t.is_high ? 'color-mix(in oklab, var(--accent) 17%, var(--surface-raised))' : 'var(--surface-raised)'}
                      stroke="var(--surface-edge)"
                      strokeWidth={1.6}
                      style={{ cursor: 'pointer' }}
                      onClick={() => pick.clickTableBody(t)}
                    />
                    <text
                      x={w / 2}
                      y={h / 2 + 4}
                      textAnchor="middle"
                      fontSize={w >= 100 ? 13 : 11.5}
                      fontWeight={600}
                      fill="var(--text)"
                      style={{ pointerEvents: 'none' }}
                    >
                      {w >= 100 ? t.name.replace(/^.*-\s*/, '') : t.seats}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}

      {area && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[var(--text-muted)]">
            {joining
              ? 'Tap a fully free table to join it - it will be held in full, for this party alone.'
              : selectedTable
                ? `${tables.find((t) => t.id === selectedTable)?.name ?? 'Table'}${
                    joinedTables.map((t) => ` + ${t.name}`).join('')
                  } - ${totalPicked} of ${partySize} picked`
                : 'Click a free seat to start'}
          </p>
          <div className="flex items-center gap-2">
            {selectedTable && !joining && totalPicked < partySize && (
              <button onClick={() => addChairs(1)} className="btn btn-quiet">
                + Add a chair
              </button>
            )}
            {selectedTable && !joining && (
              <button onClick={() => pick.setJoining(true)} className="btn btn-quiet">
                {joinedTableIds.length > 0 ? '+ Join another table' : '+ Join a table'}
              </button>
            )}
            {selectedTable && !joining && joinedTableIds.length > 0 && (
              <button onClick={() => pick.setJoinedTableIds([])} className="btn btn-quiet">
                Un-join {joinedTableIds.length === 1 ? 'table' : 'all'}
              </button>
            )}
            {joining && (
              <button onClick={() => pick.setJoining(false)} className="btn btn-quiet">
                Cancel join
              </button>
            )}
            <button
              onClick={() =>
                selectedTable && onAssign(selectedTable, [...selectedSeats].sort((a, b) => a - b), joinedTableIds)
              }
              disabled={!canAssign}
              className="btn btn-primary"
            >
              Seat here
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
