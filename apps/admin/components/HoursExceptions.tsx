'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchHoursExceptions, removeHoursException, setHoursException } from '@tannin/supabase';
import type { HoursException } from '@tannin/supabase';
import { toISODate } from '@tannin/core';
import { getDb } from '@/lib/supabase';

/**
 * Exceptional opening hours, shown on the website.
 *
 * Two kinds, one row per date: the door is shut all day (Christmas), or it opens
 * for a one-off window (closing at 23:00 for an event). Nothing here touches
 * bookings - Ta-nnin books through Zenchef; this only changes what the site's
 * hours block says. The regular week lives in the Opening hours editor below.
 */
export function HoursExceptions() {
  const [rows, setRows] = useState<HoursException[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [date, setDate] = useState('');
  const [closedAllDay, setClosedAllDay] = useState(true);
  const [opens, setOpens] = useState('17:00');
  const [closes, setCloses] = useState('23:00');
  const [note, setNote] = useState('');

  const todayISO = toISODate(new Date());

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await fetchHoursExceptions(getDb(), todayISO));
    } catch {
      // No exceptions yet reads the same as an empty list - don't put a scary
      // banner over an empty panel. A real failure surfaces when you try to save.
      setRows([]);
    }
  }, [todayISO]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!date) return;
    if (!closedAllDay && (!opens || !closes)) return;
    setBusy(true);
    setError(null);
    try {
      await setHoursException(getDb(), {
        date,
        closed: closedAllDay,
        opens: closedAllDay ? null : opens,
        closes: closedAllDay ? null : closes,
        note: note.trim() || null,
      });
      setDate('');
      setNote('');
      setClosedAllDay(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    }
    setBusy(false);
  }

  async function remove(d: string) {
    setError(null);
    try {
      await removeHoursException(getDb(), d);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that.');
    }
  }

  const fmt = (d: string) =>
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${d}T00:00:00`));

  return (
    <main className="admin-main">
      <h1 className="page-title">Opening hours</h1>
      <p className="page-dek">
        One-off changes to the hours on the website - a day the door is shut (Christmas), or a night
        you open different hours (closing at 23:00 for an event). The regular week is set further
        down.
      </p>

      {error && <p className="mt-4 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}

      <div className="card mt-6 p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              min={todayISO}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Date"
              className="field min-h-11 w-auto"
            />
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={closedAllDay}
                onChange={(e) => setClosedAllDay(e.target.checked)}
              />
              Closed all day
            </label>
            {!closedAllDay && (
              <>
                <input
                  type="time"
                  step={900}
                  value={opens}
                  onChange={(e) => setOpens(e.target.value)}
                  aria-label="Opens"
                  className="field min-h-11 w-auto"
                />
                <span className="text-[var(--text-muted)]">–</span>
                <input
                  type="time"
                  step={900}
                  value={closes}
                  onChange={(e) => setCloses(e.target.value)}
                  aria-label="Closes"
                  className="field min-h-11 w-auto"
                />
              </>
            )}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Shown on the site - Christmas, Private event…"
            aria-label="Note shown on the website"
            className="field min-h-11"
          />
          <div>
            <button onClick={add} disabled={busy || !date} className="btn btn-primary min-h-11">
              {busy ? 'Saving…' : 'Add exception'}
            </button>
          </div>
        </div>

        {rows === null ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">One moment…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">No exceptions coming up.</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-2 border-t border-[var(--surface-edge)] pt-4">
            {rows.map((r) => (
              <li key={r.date} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[0.85rem]">
                  <span className="tabular-nums">{fmt(r.date)}</span> -{' '}
                  {r.closed ? 'Closed' : `${r.opens} – ${r.closes}`}
                  {r.note ? <span className="text-[var(--text-muted)]"> · {r.note}</span> : null}
                </span>
                <button onClick={() => remove(r.date)} className="btn btn-quiet">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
