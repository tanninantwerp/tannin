'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { fetchAreaClosures, fetchBookingsBetween, fetchNewEventDates, searchBookings } from '@tannin/supabase';
import type { AreaClosure } from '@tannin/supabase';
import { availabilityFor, toISODate } from '@tannin/core';
import type { Blackout, Booking, BookingArea } from '@tannin/core';
import { getDb } from '@/lib/supabase';
import { getLastSeen, markSeen } from '@/lib/newEventsSeen';
import {
  BookingStatusActions,
  STATUS_CHIP as CHIP,
  SETTLED_STATUSES as SETTLED,
} from '@/components/BookingStatusActions';
import { BookingEditor } from '@/components/BookingEditor';
import {
  AREAS,
  AREA_LABEL,
  StatusDot,
  closedAreasForDate,
  dayCellClass,
  fullAreasForDate,
  statusFromParts,
  statusLabel,
} from '@/lib/dayStatus';
import type { DayStatus } from '@/lib/dayStatus';

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function shiftMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/**
 * The month, not the night.
 *
 * Tonight answers "who is coming today"; this answers "how busy is the
 * fortnight ahead" - the question behind a staff rota or a wine order, which
 * needs covers summed across weeks, not read one day at a time by paging
 * through the day view thirty times.
 */
export function ReservationsOverview() {
  // `?date=` is Tonight's board linking back to the day its banner was about.
  const linkedDate = useSearchParams().get('date');
  const validLinkedDate = linkedDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedDate) ? linkedDate : null;

  const [viewMonth, setViewMonth] = useState(() =>
    validLinkedDate ? startOfMonth(new Date(`${validLinkedDate}T12:00:00Z`)) : startOfMonth(new Date()),
  );
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blackouts, setBlackouts] = useState<Blackout[]>([]);
  const [areaClosures, setAreaClosures] = useState<AreaClosure[]>([]);
  const [fullAreasByDate, setFullAreasByDate] = useState<Map<string, BookingArea[]>>(new Map());
  const [newDates, setNewDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(() => validLinkedDate);

  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<Booking[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const runSearch = useCallback(async (term: string) => {
    const clean = term.trim();
    if (clean.length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      setResults(await searchBookings(getDb(), clean));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced so a name typed a letter at a time is one query, not eight.
  useEffect(() => {
    const timer = setTimeout(() => runSearch(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm, runSearch]);

  /*
   * Which days get a new-activity dot on the calendar - read against whenever
   * this device last opened Reservations, captured once before that timestamp
   * moves. Marking seen straight after means the dots stay lit for this visit
   * (so opening the page doesn't erase the very thing it opened to show) but
   * the hub badge and the next visit's dots start fresh from here.
   */
  useEffect(() => {
    const since = getLastSeen('reservations');
    fetchNewEventDates(getDb(), since)
      .then((dates) => setNewDates(new Set(dates)))
      .catch(() => {});
    markSeen('reservations');
  }, []);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const from = toISODate(new Date(year, month, 1));
  const to = toISODate(new Date(year, month + 1, 0));
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bookingRows, blackoutRows, areaClosureRows] = await Promise.all([
        fetchBookingsBetween(getDb(), from, to),
        getDb().from('blackouts').select('id, date, reason, from, to').gte('date', from).lte('date', to),
        fetchAreaClosures(getDb()),
      ]);
      setBookings(bookingRows);
      if (blackoutRows.error) throw blackoutRows.error;
      setBlackouts((blackoutRows.data ?? []) as Blackout[]);
      setAreaClosures(areaClosureRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that month.');
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const closedAreasFor = useCallback((iso: string) => closedAreasForDate(iso, areaClosures), [areaClosures]);

  /*
   * Fully booked, area by area - probed against the real table plan via the
   * same `free_slots` the guest's own booking form calls, so this can never
   * show room where none exists.
   *
   * Only for today onward - a busy Tuesday three weeks ago isn't a question
   * this screen needs to answer, and skipping it keeps the probe to the days
   * actually being planned around.
   */
  useEffect(() => {
    let cancelled = false;
    const todayISO = toISODate(new Date());
    const db = getDb();

    async function probeDay(iso: string): Promise<[string, BookingArea[]] | null> {
      const closed = closedAreasFor(iso);
      if (closed.length >= AREAS.length) return null;

      const av = availabilityFor({ isoDate: iso, blackouts });
      if (!av.bookable || av.slots.length === 0) return null;

      const openAreas = AREAS.filter((a) => !closed.includes(a));
      const full = await fullAreasForDate(db, iso, openAreas, av.slots);
      return full.length > 0 ? [iso, full] : null;
    }

    async function run() {
      const isoDates = Array.from({ length: daysInMonth }, (_, i) => toISODate(new Date(year, month, i + 1))).filter(
        (iso) => iso >= todayISO,
      );
      const settled = await Promise.all(isoDates.map((iso) => probeDay(iso).catch(() => null)));
      if (!cancelled) {
        setFullAreasByDate(new Map(settled.filter((e): e is [string, BookingArea[]] => e !== null)));
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [year, month, daysInMonth, blackouts, closedAreasFor]);

  const dayStatus = useCallback(
    (iso: string): DayStatus | null => {
      const todayISO = toISODate(new Date());
      if (iso < todayISO) return null;
      return statusFromParts(blackouts, areaClosures, iso, fullAreasByDate.get(iso) ?? []);
    },
    [blackouts, areaClosures, fullAreasByDate],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      const list = map.get(b.date);
      if (list) list.push(b);
      else map.set(b.date, [b]);
    }
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return map;
  }, [bookings]);

  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(viewMonth);
  // Monday first, the way a Belgian reads a week - same convention as Closures.
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const todayISO = toISODate(new Date());
  const monthCovers = bookings
    .filter((b) => !SETTLED.includes(b.status))
    .reduce((sum, b) => sum + b.partySize, 0);
  const monthPending = bookings.filter((b) => b.status === 'pending').length;

  // Owner's-eye figures for the month, from the rows already in hand. No-show
  // rate is over bookings that reached their sitting (arrived or didn't), so a
  // still-upcoming confirmed table never counts against it.
  const monthNoShows = bookings.filter((b) => b.status === 'no_show').length;
  const monthArrived = bookings.filter((b) => b.status === 'seated').length;
  const monthConcluded = monthArrived + monthNoShows;
  const noShowRate = monthConcluded > 0 ? Math.round((monthNoShows / monthConcluded) * 100) : null;
  const monthLiveBookings = bookings.filter((b) => !SETTLED.includes(b.status)).length;
  const avgParty = monthLiveBookings > 0 ? (monthCovers / monthLiveBookings).toFixed(1) : null;

  const selected = selectedDate ? (byDate.get(selectedDate) ?? []) : [];
  const selectedLive = selected.filter((b) => !SETTLED.includes(b.status));
  const selectedCovers = selectedLive.reduce((sum, b) => sum + b.partySize, 0);

  return (
    <main className="admin-main">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Reservations</h1>
        <Link href="/bookings" className="btn btn-quiet">
          Today
        </Link>
      </div>
      <p className="page-dek">
        {monthCovers} covers booked across {monthLabel}
        {monthPending > 0 && ` · ${monthPending} still waiting on you`}. For a single day, use Today
        instead.
      </p>
      {(noShowRate !== null || avgParty !== null) && (
        <p className="mt-1 text-[0.8rem] text-[var(--text-muted)]">
          {avgParty !== null && `Average party ${avgParty}`}
          {avgParty !== null && noShowRate !== null && ' · '}
          {noShowRate !== null &&
            `${noShowRate}% no-shows (${monthNoShows} of ${monthConcluded} sittings)`}
        </p>
      )}

      {error && <p className="mt-4 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}
      {notice && <p className="mt-4 text-[var(--fs-body)] text-[var(--text-muted)]">{notice}</p>}

      <div className="mt-6">
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Find a booking - name, phone, email, or TN-code"
          aria-label="Search bookings"
          className="field w-full"
        />
      </div>

      {results !== null && (
        <section className="card mt-4 p-4">
          <p className="text-sm font-medium">
            {searching
              ? 'Searching…'
              : results.length === 0
                ? 'No bookings match that.'
                : `${results.length} ${results.length === 1 ? 'match' : 'matches'}`}
          </p>
          {results.length > 0 && (
            <ul className="mt-3 flex flex-col divide-y divide-[var(--surface-edge)]">
              {results.map((b) => (
                <li key={b.id} className={`flex flex-col gap-2 py-2.5 ${SETTLED.includes(b.status) ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[0.85rem]">
                      <strong>
                        {new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(
                          new Date(`${b.date}T12:00:00Z`),
                        )}
                      </strong>{' '}
                      {b.time.slice(0, 5)} · {b.guestName} · {b.partySize}
                      {b.area && <span className="text-[var(--text-muted)]"> · {AREA_LABEL[b.area]}</span>}
                      {b.refCode && <span className="text-[var(--text-muted)]"> · {b.refCode}</span>}
                    </span>
                    <span className={`chip ${CHIP[b.status]}`}>{b.status.replace('_', ' ')}</span>
                  </div>
                  {(b.guestPhone || b.guestEmail) && (
                    <span className="text-[0.78rem] text-[var(--text-muted)]">
                      {[b.guestPhone, b.guestEmail].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {b.notes && (
                    <span className="inline-flex items-start gap-1.5 rounded-md bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-2 py-1 text-[0.8rem]">
                      <span aria-hidden="true">⚠</span>
                      <span>{b.notes}</span>
                    </span>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <BookingStatusActions id={b.id} status={b.status} onChanged={() => runSearch(searchTerm)} />
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
                        runSearch(searchTerm);
                        load();
                      }}
                      onClose={() => setEditingId(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="card mt-6 p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              setViewMonth((m) => shiftMonth(m, -1));
              setSelectedDate(null);
            }}
            className="btn btn-quiet min-h-11 w-11 px-0"
            aria-label="Previous month"
          >
            ←
          </button>
          <p className="text-[0.85rem] font-medium">{monthLabel}</p>
          <button
            onClick={() => {
              setViewMonth((m) => shiftMonth(m, 1));
              setSelectedDate(null);
            }}
            className="btn btn-quiet min-h-11 w-11 px-0"
            aria-label="Next month"
          >
            →
          </button>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[var(--fs-label)] text-[var(--text-muted)]">
          {WEEKDAY_LABELS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">One moment…</p>
        ) : (
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <span key={`blank-${i}`} aria-hidden="true" />;
              const iso = toISODate(new Date(year, month, day));
              const dayBookings = byDate.get(iso) ?? [];
              const covers = dayBookings
                .filter((b) => !SETTLED.includes(b.status))
                .reduce((sum, b) => sum + b.partySize, 0);
              const pending = dayBookings.some((b) => b.status === 'pending');
              const isToday = iso === todayISO;
              const isSelected = selectedDate === iso;
              const status = dayStatus(iso);
              const isNew = newDates.has(iso);

              return (
                <button
                  key={iso}
                  onClick={() => setSelectedDate(isSelected ? null : iso)}
                  className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-md border text-[0.78rem] tabular-nums transition-colors ${
                    status ? dayCellClass(status.state) : ''
                  } ${covers > 0 ? 'border-[var(--surface-edge)]' : 'border-transparent'} ${
                    isToday ? 'ring-1 ring-[var(--accent)]' : ''
                  } ${isSelected ? 'ring-2 ring-[var(--accent)]' : ''}`}
                >
                  {/* A new request or guest cancellation landed on this day since Reservations was last opened. */}
                  {isNew && (
                    <span
                      aria-label="New activity"
                      className="absolute right-1 top-1 size-1.5 rounded-full"
                      style={{ background: 'var(--danger)' }}
                    />
                  )}
                  <span className={status ? 'font-bold' : ''}>{day}</span>
                  {covers > 0 && (
                    <span className={`text-[0.68rem] ${pending ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                      {covers}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--surface-edge)] pt-3 text-[0.68rem] text-[var(--text-muted)]">
          <span className="flex items-center gap-1.5">
            <StatusDot state="open" /> Open
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot state="closed-half" /> Area closed
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot state="closed" /> Closed
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot state="full-half" /> Area full
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot state="full" /> Fully booked
          </span>
        </div>
      </div>

      {selectedDate &&
        (() => {
          const status = dayStatus(selectedDate);
          const areaCovers = new Map<BookingArea, number>();
          for (const b of selectedLive) {
            if (b.area) areaCovers.set(b.area, (areaCovers.get(b.area) ?? 0) + b.partySize);
          }
          const areasWithCovers = AREAS.filter((a) => areaCovers.has(a));

          return (
            <section className="card mt-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(
                    new Date(`${selectedDate}T12:00:00Z`),
                  )}
                </p>
                <div className="flex items-center gap-3">
                  {status && status.state !== 'open' && (
                    <span className="flex items-center gap-1.5 text-[0.72rem] uppercase tracking-wide text-[var(--text-muted)]">
                      <StatusDot state={status.state} />
                      {statusLabel(status)}
                    </span>
                  )}
                  <Link href={`/tables/day?date=${selectedDate}`} className="btn btn-quiet">
                    Show map
                  </Link>
                </div>
              </div>

              {status?.closedReason && (
                <p className="mt-1 text-[0.8rem] text-[var(--text-muted)]">{status.closedReason}</p>
              )}

              {selectedLive.length > 0 && (
                <p className="mt-0.5 text-[0.8rem] text-[var(--text-muted)]">
                  {selectedLive.length} {selectedLive.length === 1 ? 'booking' : 'bookings'} · {selectedCovers}{' '}
                  {selectedCovers === 1 ? 'person' : 'people'}
                  {areasWithCovers.length > 0 &&
                    ` · ${areasWithCovers.map((a) => `${AREA_LABEL[a]} ${areaCovers.get(a)}`).join(' · ')}`}
                </p>
              )}

              {selected.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing booked.</p>
              ) : (
                <ul className="mt-3 flex flex-col divide-y divide-[var(--surface-edge)]">
                  {selected.map((b) => (
                    <li key={b.id} className={`flex flex-col gap-2 py-2.5 ${SETTLED.includes(b.status) ? 'opacity-60' : ''}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[0.85rem]">
                          <strong>{b.time.slice(0, 5)}</strong> · {b.guestName} · {b.partySize}
                          {b.area && <span className="text-[var(--text-muted)]"> · {AREA_LABEL[b.area]}</span>}
                          {b.refCode && <span className="text-[var(--text-muted)]"> · {b.refCode}</span>}
                        </span>
                        <span className={`chip ${CHIP[b.status]}`}>{b.status.replace('_', ' ')}</span>
                      </div>
                      {b.notes && (
                        <span className="inline-flex items-start gap-1.5 rounded-md bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-2 py-1 text-[0.8rem]">
                          <span aria-hidden="true">⚠</span>
                          <span>{b.notes}</span>
                        </span>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <BookingStatusActions id={b.id} status={b.status} onChanged={() => load()} />
                        <button
                          onClick={() => setEditingId(editingId === b.id ? null : b.id)}
                          className={`btn ${editingId === b.id ? 'btn-primary' : 'btn-quiet'}`}
                        >
                          Edit
                        </button>
                        <Link
                          href={`/tables/day?date=${selectedDate}${b.area ? `&area=${b.area}` : ''}`}
                          className="btn btn-quiet"
                        >
                          Show map
                        </Link>
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
            </section>
          );
        })()}
    </main>
  );
}
