'use client';

import { useCallback, useEffect, useState } from 'react';
import { createDrink, deleteDrink, setDrinkSoldOut, setOnMenu, updateDrink } from '@tannin/supabase';
import type { DrinkCategory } from '@tannin/core';
import { getDb } from '@/lib/supabase';
import { OffMenuList } from './OffMenuList';

interface Row {
  id: string;
  section_id: DrinkCategory;
  name: string;
  note: string | null;
  price: number;
  sold_out: boolean;
  on_menu?: boolean;
  position: number;
}

interface SectionRow {
  id: DrinkCategory;
  title: string;
  position: number;
}

const BLANK = { name: '', note: '', price: '' };

/**
 * The bar list, editable.
 *
 * The list moves weekly, so this is the screen Tawat will actually live in. It
 * is built around the two things that happen most: marking a bottle sold out
 * mid-service, and changing a price. Both are one interaction, in place - no
 * modal, no separate edit page, no save button to hunt for.
 */
export function BarListEditor() {
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<DrinkCategory | null>(null);
  const [draft, setDraft] = useState(BLANK);

  const load = useCallback(async () => {
    setError(null);
    const [s, d] = await Promise.all([
      getDb().from('drink_sections').select('id, title, position').order('position'),
      getDb().from('drinks').select('*').order('position'),
    ]);
    if (s.error || d.error) {
      setError((s.error ?? d.error)!.message);
    } else {
      setSections((s.data ?? []) as SectionRow[]);
      setRows(((d.data ?? []) as Row[]).map((r) => ({ ...r, price: Number(r.price) })));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Applies the change locally first, then persists. If the write fails we
   * reload rather than leave the screen showing a price that is not real - a
   * silently wrong price on the bar list is worse than a visible error.
   */
  async function optimistic(id: string, patch: Partial<Row>, persist: () => Promise<void>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      await persist();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      load();
    }
  }

  /** Swaps a pour with its neighbour within the same section. */
  async function move(item: Row, items: Row[], direction: -1 | 1) {
    const idx = items.findIndex((r) => r.id === item.id);
    const other = items[idx + direction];
    if (!other) return;

    const [a, b] = [item.position, other.position];
    // Re-sorted, not just re-valued: a position swap that doesn't also move
    // the row in this array is invisible until the next load() re-fetches in
    // order - which reads as "did that even work" rather than a reorder.
    setRows((prev) => {
      const updated = prev.map((r) =>
        r.id === item.id ? { ...r, position: b } : r.id === other.id ? { ...r, position: a } : r,
      );
      return updated.sort((x, y) => x.position - y.position);
    });

    const [r1, r2] = await Promise.all([
      getDb().from('drinks').update({ position: b }).eq('id', item.id),
      getDb().from('drinks').update({ position: a }).eq('id', other.id),
    ]);
    if (r1.error || r2.error) {
      setError((r1.error ?? r2.error)!.message);
      load();
    }
  }

  async function add(sectionId: DrinkCategory) {
    const price = Number(draft.price.replace(',', '.'));
    if (!draft.name.trim() || Number.isNaN(price)) return;
    try {
      await createDrink(getDb(), {
        sectionId,
        name: draft.name.trim(),
        note: draft.note.trim() || undefined,
        price,
      });
      setDraft(BLANK);
      setAdding(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that.');
    }
  }

  if (loading) return <p className="p-8 text-[var(--fs-body)] text-[var(--text-muted)]">Loading the list…</p>;

  return (
    <main className="admin-main">
      <h1 className="page-title">The bar list</h1>
      <p className="page-dek">
        Changes are live the moment you make them. {rows.filter((r) => r.on_menu !== false).length} pours.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      {sections.map((section) => {
        const items = rows.filter((r) => r.section_id === section.id && r.on_menu !== false);
        const offMenu = rows.filter((r) => r.section_id === section.id && r.on_menu === false);
        return (
          <section key={section.id} className="mt-9">
            <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              {section.title}
            </h2>

            <ul className="card mt-3 divide-y divide-[var(--surface-edge)]">
              {items.map((row, i) => (
                <li key={row.id} className={`flex items-center gap-3 p-3 ${row.sold_out ? 'opacity-60' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <input
                        value={row.name}
                        onChange={(e) => setRows((p) => p.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)))}
                        onBlur={(e) => optimistic(row.id, {}, () => updateDrink(getDb(), row.id, { name: e.target.value.trim() }))}
                        aria-label="Name"
                        className="min-w-0 flex-1 bg-transparent text-[var(--fs-emphasis)]"
                      />
                      {row.sold_out && <span className="chip chip-off">Sold out</span>}
                    </div>
                    <input
                      value={row.note ?? ''}
                      placeholder="Region, grapes, what's in it…"
                      onChange={(e) => setRows((p) => p.map((r) => (r.id === row.id ? { ...r, note: e.target.value } : r)))}
                      onBlur={(e) => optimistic(row.id, {}, () => updateDrink(getDb(), row.id, { note: e.target.value.trim() }))}
                      aria-label="Note"
                      className="mt-0.5 w-full bg-transparent text-[var(--fs-label)] italic text-[var(--text-muted)]"
                    />
                  </div>

                  <input
                    inputMode="decimal"
                    value={String(row.price).replace('.', ',')}
                    onChange={(e) =>
                      setRows((p) => p.map((r) => (r.id === row.id ? { ...r, price: e.target.value as unknown as number } : r)))
                    }
                    onBlur={(e) => {
                      const price = Number(String(e.target.value).replace(',', '.'));
                      if (Number.isNaN(price)) return load();
                      optimistic(row.id, { price }, () => updateDrink(getDb(), row.id, { price }));
                    }}
                    aria-label="Price in euros"
                    className="w-16 shrink-0 bg-transparent text-right text-[var(--fs-emphasis)] font-semibold tabular-nums"
                  />

                  <button
                    onClick={() => move(row, items, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${row.name} up`}
                    title="Move up"
                    className="btn btn-quiet shrink-0 w-9 px-0"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(row, items, 1)}
                    disabled={i === items.length - 1}
                    aria-label={`Move ${row.name} down`}
                    title="Move down"
                    className="btn btn-quiet shrink-0 w-9 px-0"
                  >
                    ↓
                  </button>

                  {/* The most-used control in the room. */}
                  <button
                    onClick={() =>
                      optimistic(row.id, { sold_out: !row.sold_out }, () =>
                        setDrinkSoldOut(getDb(), row.id, !row.sold_out),
                      )
                    }
                    aria-pressed={row.sold_out}
                    title={row.sold_out ? 'Put back on the list' : 'Mark sold out'}
                    className={`btn shrink-0 ${row.sold_out ? 'btn-primary' : 'btn-quiet'}`}
                  >
                    {row.sold_out ? 'Off' : 'On'}
                  </button>

                  <button
                    onClick={() => optimistic(row.id, { on_menu: false }, () => setOnMenu(getDb(), 'drinks', row.id, false))}
                    title="Take off the menu (kept below, can come back)"
                    className="btn btn-quiet shrink-0"
                  >
                    Hide
                  </button>

                  <button
                    onClick={() => {
                      if (!confirm(`Delete ${row.name} for good? Hide keeps it for later.`)) return;
                      setRows((p) => p.filter((r) => r.id !== row.id));
                      deleteDrink(getDb(), row.id).catch(load);
                    }}
                    title="Remove"
                    className="btn btn-quiet shrink-0 text-[var(--danger)]"
                  >
                    ×
                  </button>
                </li>
              ))}

              {adding === section.id ? (
                <li className="flex flex-wrap items-center gap-2 p-3">
                  <input
                    autoFocus
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Producer - cuvée"
                    className="field flex-1"
                  />
                  <input
                    value={draft.note}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                    placeholder="Region, grapes"
                    className="field flex-1"
                  />
                  <input
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                    placeholder="0,00"
                    className="field w-24"
                  />
                  <button onClick={() => add(section.id)} className="btn btn-primary">
                    Add
                  </button>
                  <button onClick={() => { setAdding(null); setDraft(BLANK); }} className="btn btn-quiet">
                    Cancel
                  </button>
                </li>
              ) : (
                <li className="p-3">
                  <button onClick={() => setAdding(section.id)} className="btn btn-quiet w-full">
                    + Add to {section.title.toLowerCase()}
                  </button>
                </li>
              )}
            </ul>
            <OffMenuList
              items={offMenu.map((r) => ({ id: r.id, name: r.name, detail: r.note, price: r.price }))}
              onRestore={(id) => optimistic(id, { on_menu: true }, () => setOnMenu(getDb(), 'drinks', id, true))}
            />
          </section>
        );
      })}
    </main>
  );
}
