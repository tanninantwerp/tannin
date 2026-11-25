'use client';

import { useCallback, useEffect, useState } from 'react';
import { getDb } from '@/lib/supabase';

interface Table {
  id: string;
  name: string;
  seats: number;
  min_seats: number;
  area: string;
  active: boolean;
  position: number;
}

const BLANK = { name: '', seats: '2', min_seats: '1', area: 'inside' };

/*
 * Three areas a table can be tagged with - this is what the guest sees when
 * booking, and what the room actually is. `bar` is a real value, not just
 * `inside` renamed: it's what lets a guest ask for the bar specifically and
 * what `book_table` filters on. The database enforces this list too, in 0015.
 */
const AREAS = ['inside', 'terrace', 'bar'];

/*
 * But only two of those get a switch. The bar is physically part of the same
 * room as "inside" - nobody has ever opened or closed it on its own, only the
 * terrace, because that one is outdoors. So the Areas panel below shows two
 * buttons, and closing "inside" takes the bar with it. See `areasFor`.
 */
const TOGGLE_AREAS = ['inside', 'terrace'];

/** Which real `area` values a toggle button covers. */
function areasFor(toggle: string): string[] {
  return toggle === 'inside' ? ['inside', 'bar'] : [toggle];
}

/**
 * The floor plan the website books against.
 *
 * This is the screen that decides whether a stranger gets an instant
 * confirmation or a "we'll get back to you", so it is worth being exact. Every
 * row here is a real table someone can sit at; if it is not in this list, the
 * website will never book it, and if it is in this list twice, it will book it
 * twice.
 *
 * `Min` is the guard against a couple taking the six-top while four people are
 * turned away. Leave it at 1 for a table you are happy to seat anybody at.
 */
export function TablePlanEditor() {
  const [rows, setRows] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [turn, setTurn] = useState<number | null>(null);
  const [rules, setRules] = useState<{
    turn_minutes_large: number;
    large_party_threshold: number;
    buffer_minutes: number;
    pace_covers: number | null;
  } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [t, s] = await Promise.all([
      getDb()
        .from('dining_tables')
        .select('id, name, seats, min_seats, area, active, position')
        .order('position'),
      getDb()
        .from('booking_settings')
        .select('turn_minutes, turn_minutes_large, large_party_threshold, buffer_minutes, pace_covers')
        .maybeSingle(),
    ]);
    if (t.error) setError(t.error.message);
    else setRows((t.data ?? []) as Table[]);
    if (s.data) {
      setTurn(s.data.turn_minutes as number);
      setRules({
        turn_minutes_large: (s.data.turn_minutes_large as number) ?? (s.data.turn_minutes as number),
        large_party_threshold: (s.data.large_party_threshold as number) ?? 5,
        buffer_minutes: (s.data.buffer_minutes as number) ?? 0,
        pace_covers: (s.data.pace_covers as number | null) ?? null,
      });
    }
    setLoading(false);
  }, []);

  async function saveSetting(patch: Record<string, number | null>): Promise<void> {
    const { error: err } = await getDb().from('booking_settings').update(patch).eq('id', true);
    if (err) {
      setError(err.message);
      load();
    }
  }

  async function setTurnMinutes(minutes: number) {
    setTurn(minutes);
    await saveSetting({ turn_minutes: minutes });
  }

  function setRule(patch: Partial<NonNullable<typeof rules>>) {
    setRules((prev) => (prev ? { ...prev, ...patch } : prev));
    saveSetting(patch);
  }

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, change: Partial<Table>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...change } : r)));
    const { error: err } = await getDb().from('dining_tables').update(change).eq('id', id);
    if (err) {
      setError(err.message);
      load();
    }
  }

  async function add() {
    const seats = Number(draft.seats);
    const min = Number(draft.min_seats);
    if (!draft.name.trim() || !Number.isFinite(seats) || seats < 1) return;
    if (min > seats) {
      setError('The smallest party cannot be larger than the table.');
      return;
    }

    const { error: err } = await getDb().from('dining_tables').insert({
      name: draft.name.trim(),
      seats,
      min_seats: min,
      area: draft.area,
      position: rows.length + 1,
    });

    if (err) setError(err.message);
    else {
      setDraft(BLANK);
      setAdding(false);
      load();
    }
  }

  /**
   * Opening or closing a whole area at once.
   *
   * Fourteen of these tables are on the terrace, and in Belgium that is a
   * question the weather asks several times a week. Toggling them one at a time
   * is the kind of chore that ends with somebody not bothering, and a website
   * confirming outdoor tables in the rain.
   */
  async function setAreaOpen(toggle: string, open: boolean) {
    const covered = areasFor(toggle);
    setRows((prev) => prev.map((r) => (covered.includes(r.area) ? { ...r, active: open } : r)));
    const { error: err } = await getDb()
      .from('dining_tables')
      .update({ active: open })
      .in('area', covered);
    if (err) {
      setError(err.message);
      load();
    }
  }

  async function remove(row: Table) {
    // Deactivating keeps the history intact - bookings point at these rows, and
    // a deleted table would orphan them. Reversible: switching it back on
    // touches only `active` - position and floor-plan coordinates are
    // untouched the whole time, so it reappears exactly where it was.
    if (!confirm(`Take ${row.name} out of the plan? Existing bookings on it stay.`)) return;
    patch(row.id, { active: false });
  }

  async function destroy(row: Table) {
    // Permanent, unlike Remove. Any booking still pointing at this row keeps
    // the booking but loses the table assignment (the database does this -
    // see migration 0023); any date-specific override on it goes too.
    if (
      !confirm(
        `Permanently delete ${row.name}? This cannot be undone. Bookings already on it stay booked but lose this table; any per-day changes made to it are removed too.`,
      )
    ) {
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    const { error: err } = await getDb().from('dining_tables').delete().eq('id', row.id);
    if (err) {
      setError(err.message);
      load();
    }
  }

  if (loading) return <p className="p-8 text-[var(--fs-body)] text-[var(--text-muted)]">One moment…</p>;

  const live = rows.filter((r) => r.active);
  const covers = live.reduce((sum, r) => sum + r.seats, 0);

  return (
    <>
      <p className="page-dek">
        {live.length} tables, {covers} covers open right now. The website confirms a booking the
        moment one of these fits and is free.
      </p>

      {error && <p className="mt-4 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}

      <div className="card mt-6 p-4 text-sm leading-relaxed">
        <strong>Provisional.</strong> This plan was written down from memory, not measured. Until
        it matches the actual room the site will confirm tables that may not exist - or turn away
        parties it could have seated.
      </div>

      <div className="card mt-4 p-4">
        <p className="text-sm font-medium">Areas</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">
          Closing an area takes every table in it off the website at once. The terrace is the one
          this is really for - closing &ldquo;inside&rdquo; takes the bar with it too, since nobody opens or
          closes the bar on its own.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TOGGLE_AREAS.map((toggle) => {
            const covered = areasFor(toggle);
            const inArea = rows.filter((r) => covered.includes(r.area));
            const open = inArea.some((r) => r.active);
            return (
              <button
                key={toggle}
                onClick={() => setAreaOpen(toggle, !open)}
                className={`btn ${open ? 'btn-primary' : 'btn-quiet'}`}
              >
                {toggle} · {open ? 'open' : 'closed'}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card mt-4 p-4">
        <p className="text-sm font-medium">How long a table is held</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">
          After this long the table is offered to somebody else. Too short and two parties arrive
          at once; too long and the room books out on paper while sitting half empty.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[75, 90, 105, 120, 150].map((minutes) => (
            <button
              key={minutes}
              onClick={() => setTurnMinutes(minutes)}
              className={`btn ${turn === minutes ? 'btn-primary' : 'btn-quiet'}`}
            >
              {Math.floor(minutes / 60)}h{String(minutes % 60).padStart(2, '0')}
            </button>
          ))}
        </div>
      </div>

      {rules && (
        <div className="card mt-4 p-4">
          <p className="text-sm font-medium">Booking rules</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">
            The rest of what the room can promise. Each leaves the room as it is until you change it.
          </p>

          <div className="mt-4">
            <p className="text-sm font-medium">A bigger party holds a table longer</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              From this many guests up, a table is held for the longer turn instead of the one above.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-[var(--text-muted)]">From</span>
              <select
                value={rules.large_party_threshold}
                onChange={(e) => setRule({ large_party_threshold: Number(e.target.value) })}
                aria-label="Large party threshold"
                className="field w-auto"
              >
                {[3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} guests
                  </option>
                ))}
              </select>
              <span className="text-sm text-[var(--text-muted)]">hold for</span>
              {[105, 120, 150, 180, 210].map((minutes) => (
                <button
                  key={minutes}
                  onClick={() => setRule({ turn_minutes_large: minutes })}
                  className={`btn ${rules.turn_minutes_large === minutes ? 'btn-primary' : 'btn-quiet'}`}
                >
                  {Math.floor(minutes / 60)}h{String(minutes % 60).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-medium">Reset gap between sittings</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Kept free after a booking so the table can be cleared and reset before the next one.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {[0, 10, 15, 20, 30].map((minutes) => (
                <button
                  key={minutes}
                  onClick={() => setRule({ buffer_minutes: minutes })}
                  className={`btn ${rules.buffer_minutes === minutes ? 'btn-primary' : 'btn-quiet'}`}
                >
                  {minutes === 0 ? 'None' : `${minutes} min`}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-medium">Pacing - covers per 15 minutes</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              The most covers that may arrive in the same quarter-hour, so the kitchen is not handed
              the whole room at once. Off means no limit.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setRule({ pace_covers: null })}
                className={`btn ${rules.pace_covers === null ? 'btn-primary' : 'btn-quiet'}`}
              >
                Off
              </button>
              <input
                type="number"
                min={1}
                max={1000}
                value={rules.pace_covers ?? ''}
                onChange={(e) => setRule({ pace_covers: e.target.value ? Number(e.target.value) : null })}
                placeholder="e.g. 20"
                aria-label="Covers per 15 minutes"
                className="field w-24"
              />
              <span className="text-sm text-[var(--text-muted)]">covers</span>
            </div>
          </div>
        </div>
      )}

      {/*
       * Cards, not a spreadsheet - this used to be a raw HTML table of
       * unlabeled inputs. It still doesn't draw the room (there is nowhere
       * to draw it from: the schema only has an ordering number, not real
       * x/y positions), but every field here is now labeled and a status
       * chip says active/removed instead of a faded row.
       */}
      <ul className="card mt-6 divide-y divide-[var(--surface-edge)]">
        {rows.map((row) => (
          <li key={row.id} className={`flex flex-wrap items-center gap-2 p-3 ${row.active ? '' : 'opacity-60'}`}>
            <input
              value={row.name}
              onChange={(e) => patch(row.id, { name: e.target.value })}
              aria-label="Table name"
              className="field min-h-11 w-full min-w-[12rem] flex-1 font-medium sm:w-auto"
            />
            <label className="flex items-center gap-1 text-[var(--fs-label)] text-[var(--text-muted)]">
              Seats
              <input
                inputMode="numeric"
                value={String(row.seats)}
                onChange={(e) => {
                  const seats = Number(e.target.value);
                  if (Number.isFinite(seats) && seats >= row.min_seats) patch(row.id, { seats });
                }}
                aria-label={`Seats at ${row.name}`}
                className="field min-h-11 w-14"
              />
            </label>
            <label className="flex items-center gap-1 text-[var(--fs-label)] text-[var(--text-muted)]">
              Min
              <input
                inputMode="numeric"
                value={String(row.min_seats)}
                onChange={(e) => {
                  const min_seats = Number(e.target.value);
                  if (Number.isFinite(min_seats) && min_seats >= 1 && min_seats <= row.seats) {
                    patch(row.id, { min_seats });
                  }
                }}
                aria-label={`Smallest party for ${row.name}`}
                className="field min-h-11 w-14"
              />
            </label>
            <select
              value={row.area}
              onChange={(e) => patch(row.id, { area: e.target.value })}
              aria-label={`Where ${row.name} is`}
              className="field min-h-11 w-28"
            >
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            <button
              onClick={() => (row.active ? remove(row) : patch(row.id, { active: true }))}
              title={row.active ? 'Active - tap to take it out of the plan' : 'Removed - tap to bring it back'}
              className={`chip ml-auto min-h-11 ${row.active ? 'chip-on' : 'chip-off'}`}
            >
              {row.active ? 'Active' : 'Removed'}
            </button>
            {!row.active && (
              <button onClick={() => destroy(row)} className="btn btn-quiet min-h-11 text-[var(--danger)]">
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Name"
            className="field w-24"
          />
          <input
            inputMode="numeric"
            value={draft.seats}
            onChange={(e) => setDraft({ ...draft, seats: e.target.value })}
            placeholder="Seats"
            className="field w-16"
          />
          <input
            inputMode="numeric"
            value={draft.min_seats}
            onChange={(e) => setDraft({ ...draft, min_seats: e.target.value })}
            placeholder="Min"
            className="field w-16"
          />
          <select
            value={draft.area}
            onChange={(e) => setDraft({ ...draft, area: e.target.value })}
            className="field w-28"
          >
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button onClick={add} className="btn btn-primary">
            Add
          </button>
          <button
            onClick={() => {
              setAdding(false);
              setDraft(BLANK);
            }}
            className="btn btn-quiet"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="btn btn-quiet mt-4">
          Add a table
        </button>
      )}
    </>
  );
}
