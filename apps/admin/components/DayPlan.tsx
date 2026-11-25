'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  addSeatsDeltaOverride,
  fetchDayOverrides,
  moveAdhocOverride,
  setBookingSeats,
  updateSeatsDeltaOverride,
} from '@tannin/supabase';
import type { TableDayOverride } from '@tannin/supabase';
import { addDays, toISODate } from '@tannin/core';
import type { Booking, BookingArea, BookingStatus } from '@tannin/core';
import { getDb } from '@/lib/supabase';
import { GRID, ZONES, condensedSeatOrder, connectLinks, seatsRel } from '@/lib/floorGeometry';
import type { FloorTable } from '@/lib/floorGeometry';
import { computeOccupied, DEFAULT_TURN_SETTINGS } from '@/lib/occupancy';
import type { TurnSettings } from '@/lib/occupancy';
import { useSeatPicking } from '@/lib/useSeatPicking';
import { ConnectLinks, DashedLine, Dot, RingDot, SeatLegend, ZoneBackground } from '@/components/FloorMapChrome';
import { BookingStatusActions } from '@/components/BookingStatusActions';
import { ServiceViewToggle } from '@/components/ServiceViewToggle';
import { DayNote } from '@/components/DayNote';
import { BookingEditor } from '@/components/BookingEditor';

interface BaseTable {
  id: string;
  name: string;
  seats: number;
  min_seats: number;
  area: string;
  active: boolean;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  is_high: boolean;
  is_shared: boolean;
  vertical: boolean;
  one_row: boolean;
  flip_row: boolean;
  ends: boolean;
  connect_group: string | null;
}

interface BookingRow {
  id: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  notes: string | null;
  party_size: number;
  time: string;
  status: BookingStatus;
  table_id: string | null;
  joined_table_ids: string[];
  day_override_table_id: string | null;
  seat_indices: number[] | null;
  requested_area: BookingArea | null;
  ref_code: string | null;
  created_at: string;
}

/** The fuller shape BookingEditor/SeatPicker expect, from the lean row this map fetches. */
function toBooking(b: BookingRow, date: string): Booking {
  return {
    id: b.id,
    date,
    time: b.time,
    partySize: b.party_size,
    guestName: b.guest_name,
    guestEmail: b.guest_email ?? undefined,
    guestPhone: b.guest_phone ?? undefined,
    notes: b.notes ?? undefined,
    status: b.status,
    createdAt: b.created_at,
    tableId: b.table_id ?? undefined,
    joinedTableIds: b.joined_table_ids,
    seatIndices: b.seat_indices ?? undefined,
    area: b.requested_area ?? undefined,
    refCode: b.ref_code ?? undefined,
  };
}

/** A render-ready table: either a real one (with any override applied) or an ad-hoc one for the night. */
type RenderTable = FloorTable & {
  kind: 'real' | 'adhoc';
  overrideId: string | null;
  closed: boolean;
  seatsDelta: number;
};

/**
 * One night's plan: the real room, with whatever has been forced onto this
 * date layered on top - a table given extra chairs, a table taken out, a
 * pop-up table dropped in for a private event - and who is actually sitting
 * where, read off the day's bookings.
 *
 * Assigning a booking to a table is still the dropdown in Tonight's board;
 * this is the glance view over the top of it, plus the place to add or
 * remove the overrides themselves.
 */
export function DayPlan() {
  // `?date=` is Tonight's and Reservations' "Show map" links back to a
  // specific night rather than always landing on today. `?area=` is a
  // booking-specific "Show map" landing straight on that booking's zone,
  // rather than always opening on Terrace regardless of where the party is.
  const params = useSearchParams();
  const linkedDate = params.get('date');
  const validLinkedDate = linkedDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedDate) ? linkedDate : null;
  const linkedArea = params.get('area');
  const validLinkedArea = linkedArea && ZONES.some((z) => z.area === linkedArea) ? linkedArea : null;
  const [date, setDate] = useState(() => validLinkedDate ?? toISODate(new Date()));
  const [tables, setTables] = useState<BaseTable[]>([]);
  const [overrides, setOverrides] = useState<TableDayOverride[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Reseating happens on this same map rather than a second one: the target
  // booking's own seats stop reading as taken (computed fresh, at its own
  // time, via computeOccupied - the same logic SeatPicker uses, not the
  // whole-day glance takenSeats() below reads for ordinary browsing), and
  // clicking any other table or chair places it there.
  const [reseatingId, setReseatingId] = useState<string | null>(null);
  const [turnSettings, setTurnSettings] = useState<TurnSettings>(DEFAULT_TURN_SETTINGS);
  const [popup, setPopup] = useState<{
    table: RenderTable;
    x: number;
    y: number;
    place: 'above' | 'below';
    maxH: number;
  } | null>(null);
  // How tall the map is allowed to be so the whole zone sits within what is
  // left of the viewport - measured from the frame's own top edge rather than
  // guessed, so the room's header, date and legend can change without breaking
  // the fit. Null until measured, then kept current on resize.
  const [mapMaxH, setMapMaxH] = useState<number | null>(null);
  // One area on screen at a time - the whole three-zone room at once is too
  // tall to read and clips the who's-here popup. Each zone gets the full width.
  const [mapArea, setMapArea] = useState<string>(() => validLinkedArea ?? 'terrace');

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ overrideId: string; startX: number; startY: number; ox: number; oy: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ overrideId: string; x: number; y: number } | null>(null);

  // The one zone on screen, cropped to fill the frame with a little breathing room.
  const zone = ZONES.find((z) => z.area === mapArea) ?? ZONES[0];
  const PAD = 30;
  const vb = { x: zone.x - PAD, y: zone.y - PAD, w: zone.w + PAD * 2, h: zone.h + PAD * 2 };
  const aspect = vb.w / vb.h;

  const load = useCallback(async () => {
    setError(null);
    try {
      const db = getDb();
      const [t, o, b, s] = await Promise.all([
        db
          .from('dining_tables')
          .select(
            'id, name, seats, min_seats, area, active, x, y, w, h, is_high, is_shared, vertical, one_row, flip_row, ends, connect_group',
          )
          .order('position'),
        fetchDayOverrides(db, date),
        db
          .from('bookings')
          .select(
            'id, guest_name, guest_email, guest_phone, notes, party_size, time, status, table_id, joined_table_ids, day_override_table_id, seat_indices, requested_area, ref_code, created_at',
          )
          .eq('date', date)
          .in('status', ['pending', 'confirmed', 'seated'])
          .order('time'),
        db.from('booking_settings')
          .select('turn_minutes, turn_minutes_large, large_party_threshold, buffer_minutes')
          .maybeSingle(),
      ]);
      if (t.error) throw t.error;
      if (b.error) throw b.error;
      setTables((t.data ?? []) as BaseTable[]);
      setOverrides(o);
      setBookings((b.data ?? []) as BookingRow[]);
      if (s.data?.turn_minutes) {
        setTurnSettings({
          turnMinutes: s.data.turn_minutes as number,
          turnMinutesLarge: (s.data.turn_minutes_large as number | null) ?? null,
          largePartyThreshold: (s.data.large_party_threshold as number | null) ?? DEFAULT_TURN_SETTINGS.largePartyThreshold,
          bufferMinutes: (s.data.buffer_minutes as number | null) ?? DEFAULT_TURN_SETTINGS.bufferMinutes,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that night.');
    }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    closePopup();
    cancelReseat();
    load();
  }, [load]);

  // Scale the map to sit within whatever height is left below its own top edge,
  // so the whole zone is visible without scrolling. Runs once the frame exists
  // (after loading) and again on resize.
  useEffect(() => {
    if (loading) return;
    function fit() {
      const el = containerRef.current;
      if (!el) return;
      const room = window.innerHeight - el.getBoundingClientRect().top - 16;
      setMapMaxH(Math.max(220, room));
    }
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [loading]);

  const renderTables: RenderTable[] = useMemo(() => {
    const real: RenderTable[] = tables
      .filter((t) => t.active)
      .map((t) => {
        const closedBy = overrides.find((o) => o.kind === 'closed' && o.tableId === t.id);
        const deltaBy = overrides.find((o) => o.kind === 'seats_delta' && o.tableId === t.id);
        return {
          ...t,
          kind: 'real',
          overrideId: null,
          closed: Boolean(closedBy),
          seatsDelta: deltaBy?.seatsDelta ?? 0,
          seats: t.seats + (deltaBy?.seatsDelta ?? 0),
        };
      });

    const adhocTables: RenderTable[] = overrides
      .filter((o) => o.kind === 'adhoc')
      .map((o, i) => {
        const zone = ZONES.find((z) => z.area === o.area) ?? ZONES[0];
        return {
          id: `adhoc-${o.id}`,
          name: o.name ?? 'Pop-up table',
          seats: o.seats ?? 2,
          min_seats: o.minSeats ?? 2,
          area: o.area ?? 'inside',
          active: true,
          x: o.x ?? zone.x + 40 + (i % 4) * 100,
          y: o.y ?? zone.y + 40 + Math.floor(i / 4) * 100,
          w: o.w ?? 74,
          h: o.h ?? 62,
          is_high: false,
          is_shared: false,
          vertical: false,
          one_row: false,
          flip_row: false,
          ends: false,
          connect_group: null,
          kind: 'adhoc',
          overrideId: o.id,
          closed: false,
          seatsDelta: 0,
        };
      });

    return [...real, ...adhocTables];
  }, [tables, overrides]);

  const links = useMemo(
    () => connectLinks(renderTables.filter((t) => t.x != null && t.y != null && t.area === mapArea)),
    [renderTables, mapArea],
  );

  /** Every booking on this table today, in the order they're seated. */
  function bookingsForTable(t: RenderTable): BookingRow[] {
    return t.kind === 'real'
      ? bookings.filter((b) => b.table_id === t.id || b.joined_table_ids.includes(t.id))
      : bookings.filter((b) => b.day_override_table_id === t.overrideId);
  }

  /** Closes the small who's-here popup and whatever edit panel is open inside it. */
  function closePopup() {
    setPopup(null);
    setEditingId(null);
  }

  function startReseat(b: BookingRow) {
    closePopup();
    setReseatingId(b.id);
    reseatPick.reset();
  }

  function cancelReseat() {
    setReseatingId(null);
    reseatPick.reset();
  }

  // Looked up by id, not held as a snapshot, so a background reload (another
  // staff member's change, the realtime feed) never leaves this pointed at
  // stale data mid-pick.
  const reseating = reseatingId ? bookings.find((b) => b.id === reseatingId) : undefined;

  /** Occupied seats at the moment being reseated - precise to that one booking's turn, not a whole-day glance. */
  const reseatOccupied = useMemo(() => {
    if (!reseating) return new Map<string, Set<number> | 'all'>();
    return computeOccupied(bookings, renderTables, reseating.time, reseating.party_size, turnSettings, reseating.id);
  }, [reseating, bookings, renderTables, turnSettings]);

  // The same click rules SeatPicker uses for a new booking - shared so the
  // two floor plans never disagree about what tapping a chair does. `0` when
  // nothing is being reseated is inert: the reseat panel (and every click
  // handler below) only ever runs while `reseating` is set.
  const reseatPick = useSeatPicking(reseatOccupied, reseating?.party_size ?? 0);

  function clickReseatSeat(tableId: string, seatIndex: number) {
    if (!reseating) return;
    reseatPick.clickSeat(tableId, seatIndex);
  }

  /** Clicking a table's body, not one chair, fills it up to the party size in one tap. */
  function clickReseatTableBody(t: RenderTable) {
    if (!reseating) return;
    reseatPick.clickTableBody(t);
  }

  /** +1 or +2 chairs for the currently-picked table, for tonight only - tops up an existing override rather than stacking a second one. */
  async function addReseatChairs(n: 1 | 2) {
    const reseatTableId = reseatPick.selectedTable;
    if (!reseatTableId) return;
    // A pop-up table has no real dining_tables row to attach an override to.
    if (renderTables.find((t) => t.id === reseatTableId)?.kind !== 'real') return;
    const existing = overrides.find((o) => o.kind === 'seats_delta' && o.tableId === reseatTableId);
    try {
      if (existing) {
        await updateSeatsDeltaOverride(getDb(), existing.id, (existing.seatsDelta ?? 0) + n);
      } else {
        await addSeatsDeltaOverride(getDb(), { date, tableId: reseatTableId, seatsDelta: n });
      }
      setNotice(`Added ${n} chair${n > 1 ? 's' : ''} - tap the table again to seat there.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add chairs.');
    }
  }

  async function confirmReseat() {
    if (!reseating || !reseatPick.selectedTable) return;
    try {
      await setBookingSeats(
        getDb(),
        reseating.id,
        reseatPick.selectedTable,
        [...reseatPick.selectedSeats].sort((a, b) => a - b),
        reseatPick.joinedTableIds,
      );
      cancelReseat();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    }
  }

  /**
   * Which seats on this table are taken, across the whole day rather than one
   * moment - this is a glance at tonight, not a check for a specific new
   * booking's own time (that's reseatOccupied, built with the same
   * computeOccupied() this shares with SeatPicker). A booking with no
   * specific seats picked (auto-allocated, or made before seat-picking
   * existed) is treated as holding every seat.
   */
  function takenSeats(t: RenderTable): Set<number> | 'all' {
    const claims = bookingsForTable(t);
    if (t.is_shared) {
      // A shared table can hold more than one party at once, so "somebody's
      // here" no longer means "the whole table's gone" - and book_table never
      // picks specific chairs for an auto-allocated party, so there is
      // nothing more precise to show than a count. Bookings with picked
      // chairs (a staff hand-assignment) claim exactly those; every other
      // claim just takes that many of whatever seats are left.
      const set = new Set<number>();
      let auto = 0;
      claims.forEach((b) => {
        if (b.seat_indices && b.seat_indices.length > 0) {
          b.seat_indices.forEach((i) => set.add(i));
        } else {
          auto += b.party_size;
        }
      });
      for (const i of condensedSeatOrder(t)) {
        if (auto <= 0) break;
        if (!set.has(i)) {
          set.add(i);
          auto--;
        }
      }
      return set;
    }
    // seat_indices, when a booking has it, describes chairs on its primary
    // table only - never on a table it merely joins, which this booking holds
    // in full.
    if (claims.some((b) => b.joined_table_ids.includes(t.id) || !b.seat_indices || b.seat_indices.length === 0)) {
      return 'all';
    }
    const set = new Set<number>();
    claims.forEach((b) => b.seat_indices!.forEach((i) => set.add(i)));
    return set;
  }

  function posFor(t: RenderTable): { x: number; y: number } {
    if (t.overrideId && dragPos && dragPos.overrideId === t.overrideId) return { x: dragPos.x, y: dragPos.y };
    return { x: t.x ?? 0, y: t.y ?? 0 };
  }

  function toSvg(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: vb.x + ((clientX - rect.left) * vb.w) / rect.width,
      y: vb.y + ((clientY - rect.top) * vb.h) / rect.height,
    };
  }

  /**
   * Who's at this table today. `onClick`, not `onPointerDown` - a drag on an
   * ad-hoc table ends in a pointerup too, and the browser's own click
   * synthesis already suppresses a click after real pointer movement, so
   * dragging one never flashes the popup open.
   */
  function openPopup(e: React.MouseEvent, t: RenderTable) {
    if (bookingsForTable(t).length === 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Keep the card (w-56, centred on the point) fully inside the map frame.
    const half = 120;
    const x = Math.max(half, Math.min(rect.width - half, e.clientX - rect.left));
    const y = e.clientY - rect.top;
    // Open toward whichever edge has more room and cap the card to it, so a
    // table near the bottom opens upward instead of running off the frame.
    const below = rect.height - y;
    const place: 'above' | 'below' = below >= y ? 'below' : 'above';
    const maxH = Math.max(120, (place === 'below' ? below : y) - 12);
    setPopup({ table: t, x, y, place, maxH });
  }

  function onPointerDown(e: React.PointerEvent, t: RenderTable) {
    setSelected(t.id);
    // Only ad-hoc tables move here - a real table's position belongs to the
    // permanent plan (the Map view), not to one night of it.
    if (t.kind !== 'adhoc' || !t.overrideId || t.x == null || t.y == null) return;
    dragRef.current = { overrideId: t.overrideId, startX: e.clientX, startY: e.clientY, ox: t.x, oy: t.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const p0 = toSvg(drag.startX, drag.startY);
    const p1 = toSvg(e.clientX, e.clientY);
    const t = renderTables.find((x) => x.overrideId === drag.overrideId);
    const w = t?.w ?? 74;
    const h = t?.h ?? 62;
    const nx = Math.max(zone.x, Math.min(zone.x + zone.w - w, drag.ox + (p1.x - p0.x)));
    const ny = Math.max(zone.y, Math.min(zone.y + zone.h - h, drag.oy + (p1.y - p0.y)));
    setDragPos({ overrideId: drag.overrideId, x: nx, y: ny });
  }

  async function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !dragPos) return;
    const x = Math.round(dragPos.x / GRID) * GRID;
    const y = Math.round(dragPos.y / GRID) * GRID;
    setDragPos(null);
    setOverrides((prev) => prev.map((o) => (o.id === drag.overrideId ? { ...o, x, y } : o)));
    try {
      await moveAdhocOverride(getDb(), drag.overrideId, x, y);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that position.');
      load();
    }
  }

  const shift = (days: number) => setDate(toISODate(addDays(new Date(`${date}T12:00:00Z`), days)));

  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(
    new Date(`${date}T12:00:00Z`),
  );

  const editingBooking = editingId ? bookings.find((b) => b.id === editingId) : undefined;
  const reseatJoinedSeats = reseatPick.joinedTableIds.reduce(
    (sum, id) => sum + (renderTables.find((t) => t.id === id)?.seats ?? 0),
    0,
  );
  const reseatTotalPicked = reseatPick.selectedSeats.length + reseatJoinedSeats;
  const canConfirmReseat = reseatPick.selectedTable != null && reseating != null && reseatTotalPicked >= reseating.party_size;
  // A pop-up table has no real dining_tables row to attach a seats_delta
  // override to - chairs only make sense for the permanent room.
  const reseatTableIsReal = renderTables.find((t) => t.id === reseatPick.selectedTable)?.kind === 'real';

  if (loading) return <p className="p-8 text-[var(--fs-body)] text-[var(--text-muted)]">One moment…</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Day plan</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="btn btn-quiet" aria-label="Previous day">
            ←
          </button>
          <button onClick={() => setDate(toISODate(new Date()))} className="btn btn-quiet">
            Today
          </button>
          <button onClick={() => shift(1)} className="btn btn-quiet" aria-label="Next day">
            →
          </button>
          <ServiceViewToggle view="map" date={date} />
        </div>
      </div>
      <p className="page-dek">
        The room for one night - add chairs, close a table, or drop in a pop-up table just for this
        date, and see who&rsquo;s already sitting where.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="field w-auto"
        />
        <span className="text-[var(--fs-body)] font-medium">{weekday}</span>
      </div>

      <DayNote date={date} />

      {error && <p className="mt-3 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}
      {notice && <p className="mt-3 text-[var(--fs-body)] text-[var(--text-muted)]">{notice}</p>}

      <SeatLegend
        items={
          reseating
            ? [
                { swatch: <Dot color="var(--danger)" />, label: 'taken' },
                { swatch: <RingDot color="var(--select)" />, label: 'picked for this move' },
                { swatch: <DashedLine />, label: 'pop-up table (drag to move)' },
              ]
            : [
                { swatch: <Dot color="var(--danger)" />, label: "taken - click the table for who's there" },
                { swatch: <DashedLine />, label: 'pop-up table (drag to move)' },
              ]
        }
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ZONES.map((z) => (
          <button
            key={z.area}
            onClick={() => {
              setMapArea(z.area);
              closePopup();
              setSelected(null);
            }}
            className={`btn ${z.area === mapArea ? 'btn-primary' : 'btn-quiet'}`}
          >
            {z.label}
          </button>
        ))}
        <Link href={`/tables/day/changes?date=${date}`} className="btn btn-primary ml-auto">
          Make changes
        </Link>
      </div>

      {reseating && (
        <div className="card mt-3 flex flex-wrap items-center justify-between gap-2 p-3">
          <p className="text-sm">
            {reseatPick.joining
              ? 'Tap a fully free table to join it - it will be held in full.'
              : `Seating ${reseating.guest_name} elsewhere - ${reseatTotalPicked} of ${reseating.party_size} picked`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {reseatPick.selectedTable && !reseatPick.joining && (
              <button onClick={() => reseatPick.setJoining(true)} className="btn btn-quiet">
                {reseatPick.joinedTableIds.length > 0 ? '+ Join another table' : '+ Join a table'}
              </button>
            )}
            {reseatPick.selectedTable && !reseatPick.joining && reseatPick.joinedTableIds.length > 0 && (
              <button onClick={() => reseatPick.setJoinedTableIds([])} className="btn btn-quiet">
                Un-join {reseatPick.joinedTableIds.length === 1 ? 'table' : 'all'}
              </button>
            )}
            {reseatPick.selectedTable && !reseatPick.joining && reseatTableIsReal && reseatTotalPicked < reseating.party_size && (
              <>
                <button onClick={() => addReseatChairs(1)} className="btn btn-quiet">
                  +1 chair
                </button>
                <button onClick={() => addReseatChairs(2)} className="btn btn-quiet">
                  +2 chairs
                </button>
              </>
            )}
            {reseatPick.joining && (
              <button onClick={() => reseatPick.setJoining(false)} className="btn btn-quiet">
                Cancel join
              </button>
            )}
            <button onClick={cancelReseat} className="btn btn-quiet">
              Cancel
            </button>
            <button onClick={confirmReseat} disabled={!canConfirmReseat} className="btn btn-primary">
              Seat here
            </button>
          </div>
        </div>
      )}

      <div className="relative mt-2">
        <div
          ref={containerRef}
          className="overflow-x-auto rounded-lg border p-1"
          style={{ background: 'var(--surface)', borderColor: 'var(--surface-edge)' }}
        >
          <svg
            ref={svgRef}
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            preserveAspectRatio="xMidYMid meet"
            className="mx-auto block h-auto w-full min-w-[320px]"
            // Cap the width so the derived height never exceeds the space left
            // in the viewport - the aspect ratio is kept, so the whole zone
            // just shrinks to fit rather than being clipped or scrolled.
            style={{ userSelect: 'none', maxWidth: mapMaxH ? `${mapMaxH * aspect}px` : undefined }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerDown={(e) => {
              if (e.target === svgRef.current) {
                setSelected(null);
                closePopup();
              }
            }}
          >
            <ZoneBackground zone={zone} />
            <ConnectLinks links={links} posFor={posFor} />

            {renderTables
              .filter((t) => t.x != null && t.y != null && t.area === mapArea)
              .map((t) => {
                const { x, y } = posFor(t);
                const w = t.w ?? 74;
                const h = t.h ?? 62;
                const taken = takenSeats(t);
                const hasBookings = bookingsForTable(t).length > 0;
                const isSelected = selected === t.id;
                return (
                  <g
                    key={t.id}
                    transform={`translate(${x} ${y})`}
                    style={{
                      cursor: reseating
                        ? 'pointer'
                        : t.kind === 'adhoc'
                          ? 'grab'
                          : hasBookings
                            ? 'pointer'
                            : 'default',
                      opacity: t.closed ? 0.32 : 1,
                    }}
                    onPointerDown={(e) => onPointerDown(e, t)}
                    onClick={(e) => (reseating ? clickReseatTableBody(t) : openPopup(e, t))}
                  >
                    {seatsRel(t).map((s, i) => {
                      if (reseating) {
                        const seatTaken = reseatPick.isTaken(t.id, i);
                        const chosen =
                          (reseatPick.selectedTable === t.id && reseatPick.selectedSeats.includes(i)) ||
                          reseatPick.joinedTableIds.includes(t.id);
                        const clickable = reseatPick.joining
                          ? t.id !== reseatPick.selectedTable &&
                            !reseatPick.joinedTableIds.includes(t.id) &&
                            reseatPick.isFullyFree(t.id)
                          : !seatTaken;
                        return (
                          <circle
                            key={i}
                            cx={s.cx}
                            cy={s.cy}
                            r={9}
                            style={{ cursor: clickable ? 'pointer' : 'not-allowed', pointerEvents: 'all' }}
                            fill={chosen ? 'var(--select)' : seatTaken ? 'var(--danger)' : 'transparent'}
                            opacity={seatTaken && !chosen ? 0.5 : reseatPick.joining && !clickable ? 0.4 : 1}
                            stroke={chosen ? 'var(--select)' : seatTaken ? 'var(--danger)' : 'var(--accent)'}
                            strokeWidth={chosen ? 2.5 : 1.4}
                            onClick={(e) => {
                              e.stopPropagation();
                              clickReseatSeat(t.id, i);
                            }}
                          />
                        );
                      }
                      const seatTaken = taken === 'all' || taken.has(i);
                      return (
                        <circle
                          key={i}
                          cx={s.cx}
                          cy={s.cy}
                          r={6}
                          fill={seatTaken ? 'var(--danger)' : t.is_high ? 'var(--accent)' : 'var(--surface)'}
                          stroke={seatTaken ? 'var(--danger)' : 'var(--accent)'}
                          strokeWidth={t.is_high || seatTaken ? 0 : 1.4}
                        />
                      );
                    })}
                    <rect
                      width={w}
                      height={h}
                      rx={9}
                      fill={
                        t.is_high
                          ? 'color-mix(in oklab, var(--accent) 17%, var(--surface-raised))'
                          : 'var(--surface-raised)'
                      }
                      stroke={isSelected ? 'var(--accent)' : 'var(--surface-edge)'}
                      strokeWidth={isSelected ? 3 : 1.6}
                      strokeDasharray={t.kind === 'adhoc' ? '5 3' : undefined}
                    />
                    <text
                      x={w / 2}
                      y={h / 2 + 4}
                      textAnchor="middle"
                      fontSize={w >= 100 ? 12 : 10.5}
                      fontWeight={600}
                      fill="var(--text)"
                      style={{ pointerEvents: 'none' }}
                    >
                      {w >= 100 ? t.name.replace(/^.*-\s*/, '') : t.seats}
                    </text>
                    {t.seatsDelta !== 0 && (
                      <text x={w - 4} y={-6} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--accent)">
                        {t.seatsDelta > 0 ? `+${t.seatsDelta}` : t.seatsDelta}
                      </text>
                    )}
                  </g>
                );
              })}
          </svg>
        </div>

        {popup && (
          <div
            className="card absolute z-10 w-56 p-3 text-sm shadow-lg"
            style={{
              left: popup.x,
              top: popup.y,
              transform:
                popup.place === 'below'
                  ? 'translate(-50%, 8px)'
                  : 'translate(-50%, calc(-100% - 8px))',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{popup.table.name.replace(/^.*-\s*/, '')}</p>
              <button onClick={closePopup} className="btn btn-quiet px-2 py-0.5" aria-label="Close">
                ✕
              </button>
            </div>
            <ul className="mt-2 flex flex-col gap-2">
              {bookingsForTable(popup.table).map((b) => {
                  const partnerNames = [b.table_id, ...b.joined_table_ids]
                    .filter((id): id is string => !!id && id !== popup.table.id)
                    .map((id) => renderTables.find((t) => t.id === id)?.name.replace(/^.*-\s*/, ''))
                    .filter((name): name is string => !!name);
                  return (
                    <li key={b.id} className="border-t border-[var(--surface-edge)] pt-2 first:border-0 first:pt-0">
                      <p>
                        <strong>{b.time.slice(0, 5)}</strong> · {b.guest_name} · party {b.party_size}
                      </p>
                      {partnerNames.length > 0 && (
                        <p className="text-[var(--text-muted)]">joined with {partnerNames.join(', ')}</p>
                      )}
                      {b.guest_phone && (
                        <a href={`tel:${b.guest_phone}`} className="text-[var(--text-muted)] hover:text-[var(--accent)]">
                          {b.guest_phone}
                        </a>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <BookingStatusActions
                          id={b.id}
                          status={b.status}
                          onChanged={() => {
                            closePopup();
                            load();
                          }}
                        />
                        <button
                          onClick={() => {
                            setPopup(null);
                            setEditingId(b.id);
                          }}
                          className="btn btn-quiet px-2 py-1 text-xs"
                        >
                          Edit
                        </button>
                        <button onClick={() => startReseat(b)} className="btn btn-quiet px-2 py-1 text-xs">
                          Seat elsewhere
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
      </div>

      {editingBooking && (
        <BookingEditor
          booking={toBooking(editingBooking, date)}
          onSaved={(result) => {
            setEditingId(null);
            setNotice(
              result
                ? result.status === 'confirmed'
                  ? 'Booking moved - a table fit.'
                  : 'Booking moved - saved as pending, nothing free fit that party.'
                : 'Booking updated.',
            );
            load();
          }}
          onClose={() => setEditingId(null)}
        />
      )}

    </div>
  );
}
