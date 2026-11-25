'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  addAdhocOverride,
  addClosedOverride,
  addSeatsDeltaOverride,
  fetchDayOverrides,
  removeDayOverride,
} from '@tannin/supabase';
import type { TableDayOverride } from '@tannin/supabase';
import { toISODate } from '@tannin/core';
import type { BookingArea } from '@tannin/core';
import { getDb } from '@/lib/supabase';

interface TableRow {
  id: string;
  name: string;
  seats: number;
  active: boolean;
}

const AREAS: BookingArea[] = ['inside', 'terrace', 'bar'];

const ADHOC_BLANK = {
  name: '',
  seats: '2',
  minSeats: '2',
  area: 'inside' as BookingArea,
};

/**
 * The place to force a change onto one night - add chairs to a table, close a
 * table, or drop in a pop-up table for a private event. Split out of the Day
 * plan so that screen is just the map: this is the editing bench, and the
 * button back to it reads "Done" rather than "Save" - each change is written
 * the moment it's added, so there is nothing held back that a "Save" label
 * would imply is still waiting to happen.
 */
export function DayPlanChanges() {
  const linkedDate = useSearchParams().get('date');
  const validLinkedDate = linkedDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedDate) ? linkedDate : null;
  const [date] = useState(() => validLinkedDate ?? toISODate(new Date()));

  const [tables, setTables] = useState<TableRow[]>([]);
  const [overrides, setOverrides] = useState<TableDayOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<'seats_delta' | 'closed' | 'adhoc'>('seats_delta');
  const [targetTableId, setTargetTableId] = useState('');
  const [seatsDelta, setSeatsDelta] = useState('1');
  const [adhoc, setAdhoc] = useState(ADHOC_BLANK);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const db = getDb();
      const [t, o] = await Promise.all([
        db.from('dining_tables').select('id, name, seats, active').order('position'),
        fetchDayOverrides(db, date),
      ]);
      if (t.error) throw t.error;
      setTables((t.data ?? []) as TableRow[]);
      setOverrides(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that night.');
    }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function addOverride() {
    setError(null);
    setSaving(true);
    try {
      if (kind === 'seats_delta') {
        const delta = Number(seatsDelta);
        if (!targetTableId || !Number.isFinite(delta) || delta === 0) {
          throw new Error('Pick a table and a non-zero number of seats.');
        }
        await addSeatsDeltaOverride(getDb(), { date, tableId: targetTableId, seatsDelta: delta });
      } else if (kind === 'closed') {
        if (!targetTableId) throw new Error('Pick a table to close.');
        await addClosedOverride(getDb(), { date, tableId: targetTableId });
      } else {
        const seats = Number(adhoc.seats);
        const minSeats = Number(adhoc.minSeats);
        if (!adhoc.name.trim() || !Number.isFinite(seats) || seats < 1) {
          throw new Error('Name and a seat count are required.');
        }
        await addAdhocOverride(getDb(), {
          date,
          name: adhoc.name.trim(),
          seats,
          minSeats: Number.isFinite(minSeats) && minSeats > 0 ? minSeats : 1,
          area: adhoc.area,
        });
        setAdhoc(ADHOC_BLANK);
      }
      setTargetTableId('');
      setSeatsDelta('1');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await removeDayOverride(getDb(), id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that.');
    }
  }

  const activeTables = tables.filter((t) => t.active);
  const dayLabel = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00Z`));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Make changes</h1>
        <Link href={`/tables/day?date=${date}`} className="btn btn-primary">
          Done
        </Link>
      </div>
      <p className="page-dek">
        {dayLabel} - add chairs to a table, close one, or drop in a pop-up table, just for this
        night. Each change applies the moment you add it - Done just takes you back to the plan.
      </p>

      {error && <p className="mt-3 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}

      {loading ? (
        <p className="mt-6 text-[var(--fs-body)] text-[var(--text-muted)]">One moment…</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:max-w-md">
          <div className="card p-4">
            <p className="text-sm font-medium">Force a change onto this night</p>

            <div className="mt-3 flex gap-2">
              {(['seats_delta', 'closed', 'adhoc'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`btn ${kind === k ? 'btn-primary' : 'btn-quiet'}`}
                >
                  {k === 'seats_delta' ? 'Add chairs' : k === 'closed' ? 'Close table' : 'Pop-up table'}
                </button>
              ))}
            </div>

            {kind !== 'adhoc' ? (
              <div className="mt-3 flex flex-col gap-2">
                <select
                  value={targetTableId}
                  onChange={(e) => setTargetTableId(e.target.value)}
                  className="field"
                  aria-label="Table"
                >
                  <option value="">Pick a table…</option>
                  {activeTables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.seats} seats
                    </option>
                  ))}
                </select>
                {kind === 'seats_delta' && (
                  <input
                    inputMode="numeric"
                    value={seatsDelta}
                    onChange={(e) => setSeatsDelta(e.target.value)}
                    placeholder="Extra seats, e.g. 1 or -1"
                    className="field"
                  />
                )}
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <input
                  value={adhoc.name}
                  onChange={(e) => setAdhoc({ ...adhoc, name: e.target.value })}
                  placeholder="Name, e.g. Private event table"
                  className="field"
                />
                <div className="flex gap-2">
                  <input
                    inputMode="numeric"
                    value={adhoc.seats}
                    onChange={(e) => setAdhoc({ ...adhoc, seats: e.target.value })}
                    placeholder="Seats"
                    className="field"
                  />
                  <input
                    inputMode="numeric"
                    value={adhoc.minSeats}
                    onChange={(e) => setAdhoc({ ...adhoc, minSeats: e.target.value })}
                    placeholder="Min party"
                    className="field"
                  />
                </div>
                <select
                  value={adhoc.area}
                  onChange={(e) => setAdhoc({ ...adhoc, area: e.target.value as BookingArea })}
                  className="field"
                >
                  {AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button onClick={addOverride} disabled={saving} className="btn btn-primary mt-3 w-full">
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>

          {overrides.length > 0 && (
            <div className="card p-4">
              <p className="text-sm font-medium">This night&rsquo;s changes</p>
              <ul className="mt-2 flex flex-col gap-2">
                {overrides.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {o.kind === 'seats_delta' &&
                        `${tables.find((t) => t.id === o.tableId)?.name ?? 'Table'} ${o.seatsDelta! > 0 ? '+' : ''}${o.seatsDelta}`}
                      {o.kind === 'closed' && `${tables.find((t) => t.id === o.tableId)?.name ?? 'Table'} - closed`}
                      {o.kind === 'adhoc' && `${o.name} - pop-up`}
                    </span>
                    <button onClick={() => remove(o.id)} className="btn btn-quiet">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
