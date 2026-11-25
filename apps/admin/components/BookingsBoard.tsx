'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  createStaffBooking,
  fetchBookings,
  removeBlackout,
  setBookingSeats,
  setBookingTable,
} from '@tannin/supabase';
import { addDays, availabilityFor, toISODate, windowFor } from '@tannin/core';
import type { Booking, BookingArea } from '@tannin/core';
import { getDb } from '@/lib/supabase';
import { markSeen } from '@/lib/newEventsSeen';
import { dayCellClass, fetchDayStatus, statusLabel } from '@/lib/dayStatus';
import type { DayStatus } from '@/lib/dayStatus';
import { SeatPicker } from '@/components/SeatPicker';
import { BookingEditor } from '@/components/BookingEditor';
import { ServiceViewToggle } from '@/components/ServiceViewToggle';
import { DayNote } from '@/components/DayNote';
import {
  BookingStatusActions,
  STATUS_CHIP as CHIP,
  SETTLED_STATUSES as SETTLED,
} from '@/components/BookingStatusActions';

interface BlackoutRow {
  id: string;
  date: string;
  reason: string;
  from: string | null;
  to: string | null;
}

interface TableRow {
  id: string;
  name: string;
  seats: number;
  area: string;
  active: boolean;
}

const AREAS: BookingArea[] = ['inside', 'terrace', 'bar'];

const BLANK_DRAFT = {
  time: '',
  partySize: '2',
  guestName: '',
  guestPhone: '',
  guestEmail: '',
  area: '' as BookingArea | '',
  notes: '',
};

/*
 * How many covers the room seats is not a constant. It was one - 40, said to
 * mirror a default in `availabilityFor` that had already been deleted as "dead
 * code giving a wrong answer". The real room is 95, and the board was telling
 * whoever was reading it that a quiet night was more than half full.
 *
 * Read from the table plan instead, counting only tables that are switched on,
 * so closing the terrace drops it by 52 the moment it is closed rather than
 * flattering the number all evening.
 */

/**
 * One day at a time.
 *
 * A service is a day, not a month - the question at 5pm is always "who is
 * coming tonight", so that is the whole screen. Requests arrive as `pending`
 * because the website cannot see how full the room is; confirming them is the
 * point of this page.
 *
 * Nothing here deletes. A cancelled table stays visible, greyed, because
 * "but I cancelled that weeks ago" is a conversation you want evidence for.
 */
export function BookingsBoard() {
  // `?date=` is how the new-booking toast (BookingNotifier) and Reservations'
  // calendar link back to a specific night rather than always landing on today.
  const params = useSearchParams();
  const linkedDate = params.get('date');
  const validLinkedDate = linkedDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedDate) ? linkedDate : null;
  const [date, setDate] = useState(() => validLinkedDate ?? toISODate(new Date()));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blackouts, setBlackouts] = useState<BlackoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [dayStatus, setDayStatus] = useState<DayStatus | null>(null);

  // ?new=1 opens the add form straight away - still honoured for any deep link,
  // though the New booking hub tile that used it is gone (its + New booking and
  // Walk-in buttons are on this screen).
  const [adding, setAdding] = useState(() => params.get('new') === '1');
  const [draft, setDraft] = useState(BLANK_DRAFT);
  const [saving, setSaving] = useState(false);
  const [pickingSeatsFor, setPickingSeatsFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, bl, dt] = await Promise.all([
        fetchBookings(getDb(), date),
        getDb().from('blackouts').select('id, date, reason, from, to').eq('date', date),
        getDb().from('dining_tables').select('id, name, seats, area, active').order('position'),
      ]);
      if (bl.error) throw bl.error;
      setBookings(b);
      setBlackouts((bl.data ?? []) as BlackoutRow[]);
      if (!dt.error) {
        const rows = (dt.data ?? []) as TableRow[];
        setTables(rows);
        setCapacity(rows.filter((t) => t.active).reduce((sum, t) => sum + t.seats, 0));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that day.');
    }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Opening Today at all clears its hub badge - not tied to which date is
  // showing, since the badge is "did anyone look at this screen".
  useEffect(() => {
    markSeen('today');
  }, []);

  /*
   * The same closed/full status the Reservations calendar colours its days
   * with, for whichever day this board is showing - a plain "closed" banner
   * said nothing about a closed terrace or a full room. Best-effort: a probe
   * that fails just leaves the banner off rather than blocking the board.
   */
  useEffect(() => {
    let cancelled = false;
    setDayStatus(null);
    fetchDayStatus(getDb(), date)
      .then((status) => {
        if (!cancelled) setDayStatus(status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date]);

  const live = bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'no_show');
  const covers = live.reduce((sum, b) => sum + b.partySize, 0);
  const pending = bookings.filter((b) => b.status === 'pending').length;
  // Seating is only a live question for pending/confirmed - a seated party is
  // already at a table by definition, and a cancelled or no-show one needs none.
  const needsSeating = bookings.filter(
    (b) => (b.status === 'pending' || b.status === 'confirmed') && !b.tableId,
  ).length;

  const window = windowFor(date);
  const label = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date(`${date}T12:00:00Z`)),
    [date],
  );
  const weekday = useMemo(
    () => new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(new Date(`${date}T12:00:00Z`)),
    [date],
  );

  /**
   * Active tables, sorted so whatever the guest asked for comes first - the
   * order staff actually wants when they open the dropdown, without hiding
   * the rest of the room if that area is full.
   */
  function tableOptions(area?: string): TableRow[] {
    const active = tables.filter((t) => t.active);
    if (!area) return active;
    return [...active.filter((t) => t.area === area), ...active.filter((t) => t.area !== area)];
  }

  async function assignTable(id: string, tableId: string | null) {
    // A plain dropdown pick means "the whole table" - any specific seats
    // chosen for it before are no longer meaningful once it's reassigned
    // this way, so they're cleared along with the table.
    setBookings((prev) =>
      prev.map((b) => (b.id === id ? { ...b, tableId: tableId ?? undefined, seatIndices: undefined } : b)),
    );
    try {
      await setBookingTable(getDb(), id, tableId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      load();
    }
  }

  async function assignSeats(id: string, tableId: string, seatIndices: number[], joinedTableIds: string[]) {
    setBookings((prev) =>
      prev.map((b) => (b.id === id ? { ...b, tableId, seatIndices, joinedTableIds } : b)),
    );
    setPickingSeatsFor(null);
    try {
      await setBookingSeats(getDb(), id, tableId, seatIndices, joinedTableIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      load();
    }
  }

  async function reopen(id: string) {
    try {
      await removeBlackout(getDb(), id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reopen that day.');
    }
  }

  const shift = (days: number) =>
    setDate(toISODate(addDays(new Date(`${date}T12:00:00Z`), days)));

  /*
   * The same slot generator the public form uses, run against this day's
   * blackouts - a phone caller should never be offered a time the website
   * would refuse. Which of these still has a table free is checked by
   * `book_table` itself at submit time, under the same date lock as every
   * other booking, so nothing here has to re-ask Postgres just to draw the
   * dropdown.
   */
  const slots = useMemo(
    () =>
      availabilityFor({
        isoDate: date,
        blackouts: blackouts.map((b) => ({
          id: b.id,
          date: b.date,
          reason: b.reason,
          from: b.from ?? undefined,
          to: b.to ?? undefined,
        })),
      }).slots,
    [date, blackouts],
  );

  function openAdd() {
    // A slot to start from when the day is open; a sensible evening default when
    // it is not - staff can book a private event on a normally-closed day, and
    // `book_table` does not gate on the service window the way the website does.
    setDraft({ ...BLANK_DRAFT, time: slots[0] ?? '19:00' });
    setDraftError(null);
    setAdding(true);
  }

  /**
   * A walk-in is a booking for right now - jump to today and prefill the
   * current time, so staff seat someone who just came through the door without
   * hunting for the slot. They still hit Book, then Seated with a table.
   */
  function openWalkIn() {
    const now = new Date();
    const hhmm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Brussels',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    setDate(toISODate(now));
    setDraft({ ...BLANK_DRAFT, time: hhmm, guestName: 'Walk-in' });
    setDraftError(null);
    setAdding(true);
  }

  async function addBooking() {
    setDraftError(null);
    const partySize = Number(draft.partySize);
    if (!draft.guestName.trim()) return setDraftError('Name is required.');
    if (!draft.time) return setDraftError('Pick a time.');
    if (!Number.isFinite(partySize) || partySize < 1 || partySize > 8) {
      return setDraftError('Party size has to be between 1 and 8.');
    }

    setSaving(true);
    try {
      const result = await createStaffBooking(getDb(), {
        date,
        time: draft.time,
        partySize,
        guestName: draft.guestName.trim(),
        guestEmail: draft.guestEmail.trim() || undefined,
        guestPhone: draft.guestPhone.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        area: draft.area || undefined,
      });

      setAdding(false);
      setDraft(BLANK_DRAFT);
      await load();

      // Same courtesy call `move()` makes on confirming a booking - skipped
      // outright with no address on file, or when it stayed pending because
      // nothing fit and there is nothing confirmed yet to tell anyone about.
      if (result.status === 'confirmed' && draft.guestEmail.trim()) {
        try {
          const { data } = await getDb().auth.getSession();
          await fetch('/api/bookings/notify', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${data.session?.access_token ?? ''}`,
            },
            body: JSON.stringify({ id: result.id, status: 'confirmed' }),
          });
        } catch {
          // The booking is already saved and on the board either way.
        }
      }

      setNotice(
        result.status === 'confirmed' ? 'Booked and confirmed.' : 'Saved as pending - nothing free fit that party.',
      );
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Could not save that booking.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="admin-main">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{label}</h1>
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
          <ServiceViewToggle view="list" date={date} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="field w-auto"
          />
          <span className="text-sm font-medium">{weekday}</span>
        </div>
        {!adding && (
          <div className="flex items-center gap-2">
            <button onClick={openWalkIn} className="btn btn-quiet">
              Walk-in
            </button>
            <button onClick={openAdd} className="btn btn-quiet">
              + New booking
            </button>
          </div>
        )}
      </div>

      <p className="mt-4 text-sm text-[var(--text-muted)]">
        {window ? `Open ${window.opens}–${window.closes}` : 'Closed on this weekday'} ·{' '}
        {capacity === null ? `${covers} covers` : `${covers} of ${capacity} covers`}
        {pending > 0 && ` · ${pending} waiting on you`}
        {needsSeating > 0 && ` · ${needsSeating} need a table`}
      </p>

      <DayNote date={date} />

      {error && <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>}
      {notice && <p className="mt-4 text-sm text-[var(--text-muted)]">{notice}</p>}

      {adding && (
        <div className="card mt-4 p-4">
          <p className="text-sm font-medium">New booking - over the phone</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">
            Books the same way the website does - a table is allocated and confirmed on the spot
            if one fits. An email is optional; without one the guest just isn&rsquo;t sent a
            confirmation.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <input
              autoFocus
              value={draft.guestName}
              onChange={(e) => setDraft({ ...draft, guestName: e.target.value })}
              placeholder="Name"
              aria-label="Guest name"
              className="field w-40"
            />
            <input
              value={draft.guestPhone}
              onChange={(e) => setDraft({ ...draft, guestPhone: e.target.value })}
              placeholder="Phone"
              aria-label="Guest phone"
              className="field w-36"
            />
            <input
              value={draft.guestEmail}
              onChange={(e) => setDraft({ ...draft, guestEmail: e.target.value })}
              placeholder="Email (optional)"
              aria-label="Guest email"
              className="field w-48"
            />
            {/* A free time input, not a slot list: staff take the odd private
                booking outside normal hours, and `book_table` allows any time. */}
            <input
              type="time"
              step={900}
              list="booking-slots"
              value={draft.time}
              onChange={(e) => setDraft({ ...draft, time: e.target.value })}
              aria-label="Time"
              className="field w-auto"
            />
            <datalist id="booking-slots">
              {slots.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <input
              inputMode="numeric"
              value={draft.partySize}
              onChange={(e) => setDraft({ ...draft, partySize: e.target.value })}
              placeholder="Party"
              aria-label="Party size"
              className="field w-16"
            />
            <select
              value={draft.area}
              onChange={(e) => setDraft({ ...draft, area: e.target.value as BookingArea | '' })}
              aria-label="Area preference"
              className="field w-32"
            >
              <option value="">Any area</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <input
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Notes"
              aria-label="Notes"
              className="field w-40"
            />
          </div>

          {draftError && <p className="mt-2 text-sm text-[var(--danger)]">{draftError}</p>}

          <div className="mt-3 flex gap-2">
            <button onClick={addBooking} disabled={saving} className="btn btn-primary">
              {saving ? 'Booking…' : 'Book'}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setDraft(BLANK_DRAFT);
                setDraftError(null);
              }}
              className="btn btn-quiet"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {blackouts.length > 0 ? (
        <div className="card mt-6 p-4">
          {blackouts.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-4">
              <p className="text-sm">
                <strong>Closed</strong>
                {b.from && b.to ? ` ${b.from}–${b.to}` : ' all day'} - {b.reason}
              </p>
              <button onClick={() => reopen(b.id)} className="btn btn-quiet">
                Reopen
              </button>
            </div>
          ))}
        </div>
      ) : (
        dayStatus &&
        dayStatus.state !== 'open' && (
          <Link
            href={`/reservations?date=${date}`}
            className={`mt-6 block rounded-md border border-[var(--surface-edge)] p-4 transition-opacity hover:opacity-90 ${dayCellClass(dayStatus.state)}`}
          >
            <p className="text-sm font-semibold">{statusLabel(dayStatus)}</p>
            {dayStatus.closedReason && <p className="mt-0.5 text-[0.8rem]">{dayStatus.closedReason}</p>}
          </Link>
        )
      )}

      {loading ? (
        <p className="mt-8 text-sm text-[var(--text-muted)]">One moment…</p>
      ) : bookings.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--text-muted)]">Nothing booked for this day.</p>
      ) : (
        <ul className="mt-6 flex flex-col">
          {bookings.map((b) => (
            <li key={b.id} className={`border-b border-[var(--surface-edge)] py-4 ${SETTLED.includes(b.status) ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-[var(--fs-emphasis)]">
                  <strong>{b.time.slice(0, 5)}</strong> · {b.guestName} · {b.partySize}
                </p>
                <span className={`chip ${CHIP[b.status]}`}>{b.status.replace('_', ' ')}</span>
              </div>

              {(b.refCode || b.cancelCode) && (
                <p className="mt-1 text-xs tracking-wide text-[var(--text-muted)]">
                  {b.refCode}
                  {b.cancelCode && <> · cancelled {b.cancelCode}</>}
                </p>
              )}

              {(b.guestEmail || b.guestPhone) && (
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  {b.guestEmail && (
                    <a href={`mailto:${b.guestEmail}`} className="hover:text-[var(--accent)]">
                      {b.guestEmail}
                    </a>
                  )}
                  {b.guestPhone && (
                    <>
                      {b.guestEmail && ' · '}
                      <a href={`tel:${b.guestPhone}`} className="hover:text-[var(--accent)]">
                        {b.guestPhone}
                      </a>
                    </>
                  )}
                </p>
              )}

              {b.notes && (
                <p className="mt-2 inline-flex items-start gap-1.5 rounded-md bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-2 py-1 text-sm">
                  <span aria-hidden="true">⚠</span>
                  <span>{b.notes}</span>
                </p>
              )}

              {(b.status === 'pending' || b.status === 'confirmed') && (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`chip ${b.tableId ? 'chip-muted' : 'chip-pending'}`}>
                      {b.tableId
                        ? `${tables.find((t) => t.id === b.tableId)?.name ?? 'Assigned'}${
                            (b.joinedTableIds ?? [])
                              .map((jid) => ` + ${tables.find((t) => t.id === jid)?.name ?? 'table'}`)
                              .join('')
                          }${
                            b.seatIndices ? ` · seat${b.seatIndices.length === 1 ? '' : 's'} ${b.seatIndices.map((i) => i + 1).join(', ')}` : ''
                          }`
                        : 'No table yet'}
                    </span>
                    <select
                      value={b.tableId ?? ''}
                      onChange={(e) => assignTable(b.id, e.target.value || null)}
                      aria-label={`Table for ${b.guestName}`}
                      className="field min-h-9 w-auto text-sm"
                    >
                      <option value="">No table</option>
                      {tableOptions(b.area).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.area} · {t.seats}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setPickingSeatsFor(pickingSeatsFor === b.id ? null : b.id)}
                      className={`btn ${pickingSeatsFor === b.id ? 'btn-primary' : 'btn-quiet'}`}
                    >
                      Pick seats on map
                    </button>
                    {b.area && (
                      <span className="text-sm text-[var(--text-muted)]">Asked for {b.area}</span>
                    )}
                  </div>
                  {pickingSeatsFor === b.id && (
                    <SeatPicker
                      bookingId={b.id}
                      date={date}
                      time={b.time}
                      partySize={b.partySize}
                      preferredArea={b.area}
                      currentTableId={b.tableId}
                      currentSeatIndices={b.seatIndices}
                      currentJoinedTableIds={b.joinedTableIds}
                      onAssign={(tableId, seatIndices, joinedTableIds) =>
                        assignSeats(b.id, tableId, seatIndices, joinedTableIds)
                      }
                      onClose={() => setPickingSeatsFor(null)}
                    />
                  )}
                </>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <BookingStatusActions
                  id={b.id}
                  status={b.status}
                  onChanged={(status) =>
                    setBookings((prev) => prev.map((x) => (x.id === b.id ? { ...x, status } : x)))
                  }
                  onNotice={setNotice}
                  onError={(message) => {
                    setError(message);
                    load();
                  }}
                />
                <button
                  onClick={() => setEditingId(editingId === b.id ? null : b.id)}
                  className={`btn ${editingId === b.id ? 'btn-primary' : 'btn-quiet'}`}
                >
                  Edit
                </button>
              </div>

              {editingId === b.id && (
                <BookingEditor
                  booking={b}
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
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
