'use client';

import { useEffect, useState } from 'react';
import { fetchServiceWindowRows, setServiceWindow } from '@tannin/supabase';
import type { ServiceWindowRow } from '@tannin/supabase';
import { getDb } from '@/lib/supabase';

const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  0: 'Sunday',
};
// Monday first, the way a Belgian reads a week - matches Closures and the site.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * The regular weekly opening hours, editable without a deploy.
 *
 * These drive the website's date picker, the booking guard, the hours block on
 * the site, and the search-result schema - all reading `service_windows` now
 * rather than a constant. `last seating` is the kitchen's last call, earlier
 * than closing; a closed day is taken out of the week without losing its times,
 * so switching it back on later brings them back. This is the standing
 * schedule; a one-off holiday still belongs in the closures below.
 */
export function HoursEditor() {
  const [rows, setRows] = useState<ServiceWindowRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchServiceWindowRows(getDb())
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the hours.'));
  }, []);

  function edit(weekday: number, patch: Partial<ServiceWindowRow>) {
    setRows((prev) => prev && prev.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (!rows) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      for (const r of rows) {
        await setServiceWindow(getDb(), r.weekday, {
          opens: r.opens,
          closes: r.closes,
          lastSeating: r.lastSeating,
          closed: r.closed,
        });
      }
      setNotice('Hours saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the hours.');
    } finally {
      setSaving(false);
    }
  }

  const byDay = new Map((rows ?? []).map((r) => [r.weekday, r]));

  return (
    <section className="card mt-6 p-4">
      <p className="text-sm font-medium">Opening hours</p>
      <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">
        The regular week. Changes take effect on the website straight away - the date picker, the
        booking check, and the hours shown to guests all follow this. A one-off holiday still goes in
        the closures below.
      </p>

      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

      {!rows ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">One moment…</p>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {WEEK_ORDER.map((wd) => {
              const r = byDay.get(wd);
              if (!r) return null;
              return (
                <div key={wd} className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-sm font-medium">{WEEKDAY_NAMES[wd]}</span>
                  <label className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
                    <input
                      type="checkbox"
                      checked={!r.closed}
                      onChange={(e) => edit(wd, { closed: !e.target.checked })}
                    />
                    Open
                  </label>
                  {!r.closed && (
                    <>
                      <input
                        type="time"
                        step={900}
                        value={r.opens}
                        onChange={(e) => edit(wd, { opens: e.target.value })}
                        aria-label={`${WEEKDAY_NAMES[wd]} opens`}
                        className="field w-auto"
                      />
                      <span className="text-[var(--text-muted)]">–</span>
                      <input
                        type="time"
                        step={900}
                        value={r.closes}
                        onChange={(e) => edit(wd, { closes: e.target.value })}
                        aria-label={`${WEEKDAY_NAMES[wd]} closes`}
                        className="field w-auto"
                      />
                      <span className="text-sm text-[var(--text-muted)]">last seating</span>
                      <input
                        type="time"
                        step={900}
                        value={r.lastSeating}
                        onChange={(e) => edit(wd, { lastSeating: e.target.value })}
                        aria-label={`${WEEKDAY_NAMES[wd]} last seating`}
                        className="field w-auto"
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="btn btn-primary">
              {saving ? 'Saving…' : 'Save hours'}
            </button>
            {notice && <span className="text-sm text-[var(--text-muted)]">{notice}</span>}
          </div>
        </>
      )}
    </section>
  );
}
