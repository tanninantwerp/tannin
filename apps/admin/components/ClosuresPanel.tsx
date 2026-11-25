'use client';

import { useCallback, useEffect, useState } from 'react';
import { addAreaClosure, addBlackout, fetchAreaClosures, removeAreaClosure, removeBlackout } from '@tannin/supabase';
import { toISODate } from '@tannin/core';
import type { AreaClosure } from '@tannin/supabase';
import type { BookingArea } from '@tannin/core';
import { getDb } from '@/lib/supabase';

interface BlackoutRow {
  id: string;
  date: string;
  reason: string;
  from: string | null;
  to: string | null;
}

const AREA_LABEL: Record<BookingArea, string> = {
  terrace: 'Terrace',
  inside: 'Inside',
  bar: 'Bar',
};

// A schematic of the room for the closures map: the three areas roughly where
// they sit (terrace out front, bar in the middle, dining room behind). Closures
// are area-level, so the individual tables don't matter here - just the zones.
const CLOSURE_ZONES: { key: BookingArea; label: string; x: number; y: number; w: number; h: number }[] = [
  { key: 'terrace', label: 'Terrace', x: 12, y: 12, w: 276, h: 66 },
  { key: 'bar', label: 'Bar', x: 66, y: 88, w: 168, h: 34 },
  { key: 'inside', label: 'Inside', x: 12, y: 132, w: 276, h: 56 },
];

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function shiftMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/**
 * Which days the room is off the website altogether.
 *
 * Its own screen rather than a card inside Tables - closing three Tuesdays in
 * December is a task on its own, not a footnote to the floor plan, and it
 * earns a button on the hub the same as Tonight or Bar list.
 */
export function ClosuresPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blackouts, setBlackouts] = useState<BlackoutRow[]>([]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [closingBusy, setClosingBusy] = useState(false);

  const [areaClosures, setAreaClosures] = useState<AreaClosure[]>([]);
  const [areaDraft, setAreaDraft] = useState({ area: 'terrace' as BookingArea, from: '', to: '', reason: '' });
  const [areaBusy, setAreaBusy] = useState(false);
  const [selectedArea, setSelectedArea] = useState<BookingArea | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [b, ac] = await Promise.all([
      getDb().from('blackouts').select('id, date, reason, from, to').order('date'),
      fetchAreaClosures(getDb()).catch((e) => {
        setError(e instanceof Error ? e.message : 'Could not load area closures.');
        return [] as AreaClosure[];
      }),
    ]);
    if (b.error) setError(b.error.message);
    else setBlackouts((b.data ?? []) as BlackoutRow[]);
    setAreaClosures(ac);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function closeSelectedDate() {
    if (!selectedDate || !closeReason.trim()) return;
    setClosingBusy(true);
    setError(null);
    try {
      await addBlackout(getDb(), { date: selectedDate, reason: closeReason.trim() });
      setCloseReason('');
      setSelectedDate(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not close that day.');
    }
    setClosingBusy(false);
  }

  async function reopenBlackout(id: string) {
    setError(null);
    try {
      await removeBlackout(getDb(), id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reopen that day.');
    }
  }

  async function closeArea() {
    if (!areaDraft.from || !areaDraft.to || !areaDraft.reason.trim()) return;
    if (areaDraft.to < areaDraft.from) {
      setError('The last day cannot come before the first.');
      return;
    }
    setAreaBusy(true);
    setError(null);
    try {
      await addAreaClosure(getDb(), {
        area: areaDraft.area,
        fromDate: areaDraft.from,
        toDate: areaDraft.to,
        reason: areaDraft.reason.trim(),
      });
      setAreaDraft({ area: areaDraft.area, from: '', to: '', reason: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not close that area.');
    }
    setAreaBusy(false);
  }

  async function reopenArea(id: string) {
    setError(null);
    try {
      await removeAreaClosure(getDb(), id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reopen that area.');
    }
  }

  if (loading) return <p className="p-8 text-[var(--fs-body)] text-[var(--text-muted)]">One moment…</p>;

  const todayISO = toISODate(new Date());
  const closedByDate = new Map(blackouts.map((b) => [b.date, b] as const));
  const upcoming = blackouts.filter((b) => b.date >= todayISO);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(viewMonth);
  // Monday first, the way a Belgian reads a week - same convention as Visit.
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const selectedBlackout = selectedDate ? closedByDate.get(selectedDate) : undefined;

  return (
    <main className="admin-main">
      <h1 className="page-title">Closures</h1>
      <p className="page-dek">
        Pick a day to take it off the website - private hire, a holiday, anything that means
        nobody should be able to book. Existing bookings on that day stay; call those guests
        yourself.
      </p>

      {error && <p className="mt-4 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}

      <div className="card mt-6 p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setViewMonth((m) => shiftMonth(m, -1))}
            className="btn btn-quiet min-h-11 w-11 px-0"
            aria-label="Previous month"
          >
            ←
          </button>
          <p className="text-[0.85rem] font-medium">{monthLabel}</p>
          <button
            onClick={() => setViewMonth((m) => shiftMonth(m, 1))}
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

        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day === null) return <span key={`blank-${i}`} aria-hidden="true" />;
            const iso = toISODate(new Date(year, month, day));
            const closed = closedByDate.get(iso);
            const isToday = iso === todayISO;
            const isPast = iso < todayISO;
            const isSelected = selectedDate === iso;
            const disabled = isPast && !closed;

            return (
              <button
                key={iso}
                onClick={() => {
                  setSelectedDate(isSelected ? null : iso);
                  setCloseReason('');
                }}
                disabled={disabled}
                title={closed ? `Closed - ${closed.reason}` : undefined}
                className={`min-h-11 rounded-md text-[0.8rem] tabular-nums transition-colors ${
                  closed ? 'chip-off' : 'border border-[var(--surface-edge)]'
                } ${isToday ? 'ring-1 ring-[var(--accent)]' : ''} ${
                  isSelected ? 'ring-2 ring-[var(--accent)]' : ''
                } ${disabled ? 'opacity-30' : ''}`}
              >
                {day}
              </button>
            );
          })}
        </div>

        {selectedDate && (
          <div className="mt-4 border-t border-[var(--surface-edge)] pt-4">
            {selectedBlackout ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[0.85rem]">
                  <strong>{selectedDate}</strong> is closed - {selectedBlackout.reason}
                </p>
                <button onClick={() => reopenBlackout(selectedBlackout.id)} className="btn btn-quiet min-h-11">
                  Reopen
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <input
                  autoFocus
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  placeholder="Private hire, holiday…"
                  aria-label={`Reason for closing ${selectedDate}`}
                  className="field min-h-11 flex-1"
                />
                <button
                  onClick={closeSelectedDate}
                  disabled={closingBusy || !closeReason.trim()}
                  className="btn btn-quiet min-h-11"
                >
                  {closingBusy ? 'Closing…' : `Close ${selectedDate}`}
                </button>
              </div>
            )}
          </div>
        )}

        {upcoming.length > 0 && (
          <div className="mt-5 border-t border-[var(--surface-edge)] pt-4">
            <p className="text-[var(--fs-label)] text-[var(--text-muted)]">Upcoming</p>
            <ul className="mt-2 flex flex-col gap-2">
              {upcoming.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[0.82rem]">
                    <span className="tabular-nums">{b.date}</span> - {b.reason}
                  </span>
                  <button onClick={() => reopenBlackout(b.id)} className="btn btn-quiet">
                    Reopen
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card mt-4 p-4">
        <p className="text-sm font-medium">Close an area</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">
          Click an area on the map to close it for a stretch of dates - the terrace for a rainy
          weekend - without shutting the whole room. A red area is already closed; click it to
          reopen. Existing bookings in that area stay; call those guests yourself.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,20rem)_1fr]">
          <div
            className="overflow-hidden rounded-lg border p-1"
            style={{ background: 'var(--surface)', borderColor: 'var(--surface-edge)' }}
          >
            <svg viewBox="0 0 300 200" className="block h-auto w-full" style={{ userSelect: 'none' }}>
              {CLOSURE_ZONES.map((z) => {
                const closed = areaClosures.some((c) => c.area === z.key && c.toDate >= todayISO);
                const isSel = selectedArea === z.key;
                return (
                  <g
                    key={z.key}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setSelectedArea(z.key);
                      setAreaDraft((d) => ({ ...d, area: z.key }));
                    }}
                  >
                    <rect
                      x={z.x}
                      y={z.y}
                      width={z.w}
                      height={z.h}
                      rx={10}
                      fill={
                        closed
                          ? 'color-mix(in oklab, var(--danger) 22%, var(--surface-raised))'
                          : 'var(--surface-raised)'
                      }
                      stroke={isSel ? 'var(--accent)' : closed ? 'var(--danger)' : 'var(--surface-edge)'}
                      strokeWidth={isSel ? 3 : 1.6}
                    />
                    <text
                      x={z.x + z.w / 2}
                      y={z.y + z.h / 2 + (closed ? -2 : 4)}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={600}
                      fill="var(--text)"
                      style={{ pointerEvents: 'none' }}
                    >
                      {z.label}
                    </text>
                    {closed && (
                      <text
                        x={z.x + z.w / 2}
                        y={z.y + z.h / 2 + 12}
                        textAnchor="middle"
                        fontSize={9}
                        fontWeight={700}
                        fill="var(--danger)"
                        style={{ pointerEvents: 'none' }}
                      >
                        CLOSED
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          <div>
            {!selectedArea ? (
              <p className="text-sm text-[var(--text-muted)]">
                Click an area on the map to close it for a stretch of dates. A red area is already
                closed - click it to reopen.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {areaClosures.filter((c) => c.area === selectedArea && c.toDate >= todayISO).length > 0 && (
                  <div>
                    <p className="text-[var(--fs-label)] text-[var(--text-muted)]">
                      {AREA_LABEL[selectedArea]} - currently closed
                    </p>
                    <ul className="mt-1 flex flex-col gap-2">
                      {areaClosures
                        .filter((c) => c.area === selectedArea && c.toDate >= todayISO)
                        .map((c) => (
                          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[0.82rem] tabular-nums">
                              {c.fromDate === c.toDate ? c.fromDate : `${c.fromDate} – ${c.toDate}`} - {c.reason}
                            </span>
                            <button onClick={() => reopenArea(c.id)} className="btn btn-quiet">
                              Reopen
                            </button>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-col gap-2 border-t border-[var(--surface-edge)] pt-3">
                  <p className="text-[var(--fs-label)] text-[var(--text-muted)]">
                    Close {AREA_LABEL[selectedArea]} for these dates
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={areaDraft.from}
                      onChange={(e) => setAreaDraft({ ...areaDraft, from: e.target.value })}
                      aria-label="First day closed"
                      className="field min-h-11 flex-1"
                    />
                    <input
                      type="date"
                      value={areaDraft.to}
                      onChange={(e) => setAreaDraft({ ...areaDraft, to: e.target.value })}
                      aria-label="Last day closed"
                      className="field min-h-11 flex-1"
                    />
                  </div>
                  <input
                    value={areaDraft.reason}
                    onChange={(e) => setAreaDraft({ ...areaDraft, reason: e.target.value })}
                    placeholder="Rain forecast…"
                    aria-label="Reason"
                    className="field min-h-11"
                  />
                  <button
                    onClick={closeArea}
                    disabled={areaBusy || !areaDraft.from || !areaDraft.to || !areaDraft.reason.trim()}
                    className="btn btn-quiet min-h-11"
                  >
                    {areaBusy ? 'Closing…' : `Close ${AREA_LABEL[selectedArea]}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {areaClosures.filter((c) => c.toDate >= todayISO).length > 0 && (
          <ul className="mt-5 flex flex-col gap-2 border-t border-[var(--surface-edge)] pt-4">
            {areaClosures
              .filter((c) => c.toDate >= todayISO)
              .map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[0.82rem]">
                    <span className="chip chip-off">{AREA_LABEL[c.area]}</span>{' '}
                    <span className="tabular-nums">
                      {c.fromDate === c.toDate ? c.fromDate : `${c.fromDate} – ${c.toDate}`}
                    </span>{' '}
                    - {c.reason}
                  </span>
                  <button onClick={() => reopenArea(c.id)} className="btn btn-quiet">
                    Reopen
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </main>
  );
}
