'use client';

import { useCallback, useEffect, useState } from 'react';
import { createMenuItem, deleteMenuItem, updateMenuItem } from '@tannin/supabase';
import type { MenuSectionId, MenuService } from '@tannin/core';
import { getDb } from '@/lib/supabase';

interface Row {
  id: string;
  section_id: string;
  name: string;
  note: string | null;
  price: number;
  price_mid: number | null;
  price_max: number | null;
  with_crackers: boolean;
  sold_out: boolean;
  position: number;
}

interface SectionRow {
  id: string;
  title: string;
  service: MenuService;
  position: number;
}

const BLANK = { name: '', note: '', price: '', priceMid: '', priceMax: '' };
const BLANK_SECTION = { title: '', service: 'kitchen' as MenuService };

/** A URL-safe id from a section title, e.g. "Land & sea" → "land-sea". */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SERVICE_LABEL: Record<MenuService, string> = {
  kitchen: 'Kitchen',
  afterhours: 'Afterhours',
};

/**
 * The food menu, editable.
 *
 * Built like the bar list, because the same person uses both and there is no
 * reason for them to behave differently. The one thing food has that drinks do
 * not is a price range - the Ibérico is 11 or 19 depending on the plate - so
 * there is a second, optional price box rather than a separate kind of item.
 */
export function MenuEditor() {
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState(BLANK);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState(BLANK_SECTION);

  const load = useCallback(async () => {
    setError(null);
    const [s, m] = await Promise.all([
      getDb().from('menu_sections').select('id, title, service, position').order('position'),
      // `*` rather than a fixed list, so price_mid is read the moment its
      // migration lands, without this failing before it.
      getDb().from('menu_items').select('*').order('position'),
    ]);
    if (s.error || m.error) {
      setError((s.error ?? m.error)!.message);
    } else {
      setSections((s.data ?? []) as SectionRow[]);
      setRows(
        ((m.data ?? []) as Row[]).map((r) => ({
          ...r,
          price: Number(r.price),
          price_mid: r.price_mid == null ? null : Number(r.price_mid),
          price_max: r.price_max === null ? null : Number(r.price_max),
        })),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Applies locally first, then persists. A failed write reloads rather than
   * leaving a wrong price on screen - the menu is printed from this.
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

  const money = (v: string) => Number(v.replace(',', '.'));

  async function add(sectionId: string) {
    const price = money(draft.price);
    if (!draft.name.trim() || Number.isNaN(price)) return;
    const priceMid = draft.priceMid.trim() ? money(draft.priceMid) : undefined;
    const priceMax = draft.priceMax.trim() ? money(draft.priceMax) : undefined;

    try {
      await createMenuItem(getDb(), {
        sectionId: sectionId as MenuSectionId,
        name: draft.name.trim(),
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
        price,
        ...(priceMid !== undefined && !Number.isNaN(priceMid) ? { priceMid } : {}),
        ...(priceMax !== undefined && !Number.isNaN(priceMax) ? { priceMax } : {}),
      });
      setDraft(BLANK);
      setAdding(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that.');
    }
  }

  /** Swaps a dish with its neighbour within the same section. */
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
      getDb().from('menu_items').update({ position: b }).eq('id', item.id),
      getDb().from('menu_items').update({ position: a }).eq('id', other.id),
    ]);
    if (r1.error || r2.error) {
      setError((r1.error ?? r2.error)!.message);
      load();
    }
  }

  async function remove(row: Row) {
    // Deleting a dish is rare and unrecoverable, unlike marking it sold out.
    if (!confirm(`Delete ${row.name}? Marking it sold out is usually what you want.`)) return;
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    try {
      await deleteMenuItem(getDb(), row.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that.');
      load();
    }
  }

  /** Swaps a section with its neighbour inside the same service. */
  async function moveSection(section: SectionRow, direction: -1 | 1) {
    const group = sections
      .filter((s) => s.service === section.service)
      .sort((a, b) => a.position - b.position);
    const idx = group.findIndex((s) => s.id === section.id);
    const other = group[idx + direction];
    if (!other) return;

    const [a, b] = [section.position, other.position];
    setSections((prev) =>
      prev
        .map((s) => (s.id === section.id ? { ...s, position: b } : s.id === other.id ? { ...s, position: a } : s))
        .sort((x, y) => x.position - y.position),
    );
    const [r1, r2] = await Promise.all([
      getDb().from('menu_sections').update({ position: b }).eq('id', section.id),
      getDb().from('menu_sections').update({ position: a }).eq('id', other.id),
    ]);
    if (r1.error || r2.error) {
      setError((r1.error ?? r2.error)!.message);
      load();
    }
  }

  /** Adds a new food section (e.g. "Land & sea") from a title and a service. */
  async function addSection() {
    const title = sectionDraft.title.trim();
    if (!title) return;
    let id = slugify(title);
    if (!id) return;
    // Keep the id unique against what's already there.
    if (sections.some((s) => s.id === id)) id = `${id}-${Date.now().toString(36).slice(-4)}`;
    const position = Math.max(-1, ...sections.map((s) => s.position)) + 1;
    const { error: err } = await getDb()
      .from('menu_sections')
      .insert({ id, title, service: sectionDraft.service, position });
    if (err) {
      setError(err.message);
      return;
    }
    setSectionDraft(BLANK_SECTION);
    setAddingSection(false);
    load();
  }

  /** Removes a section - only when it's empty, so no dishes vanish with it. */
  async function removeSection(section: SectionRow) {
    if (rows.some((r) => r.section_id === section.id)) {
      setError(`Empty ${section.title} before removing it - it still has dishes.`);
      return;
    }
    if (!confirm(`Remove the ${section.title} section?`)) return;
    const { error: err } = await getDb().from('menu_sections').delete().eq('id', section.id);
    if (err) setError(err.message);
    else load();
  }

  if (loading) return <p className="p-8 text-[var(--fs-body)] text-[var(--text-muted)]">One moment…</p>;

  let lastService: MenuService | null = null;

  return (
    <main className="admin-main">
      <h1 className="page-title">Food menu</h1>
      <p className="page-dek">
        Changes show on the website straight away.
      </p>

      {error && <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>}

      {sections.map((section) => {
        const items = rows.filter((r) => r.section_id === section.id);
        const newService = section.service !== lastService;
        lastService = section.service;
        const serviceGroup = sections
          .filter((s) => s.service === section.service)
          .sort((a, b) => a.position - b.position);
        const sIdx = serviceGroup.findIndex((s) => s.id === section.id);

        return (
          <section key={section.id} className="mt-10">
            {newService && (
              <p className="mb-6 text-[0.7rem] uppercase tracking-[0.16em] text-[var(--accent)]">
                {SERVICE_LABEL[section.service]}
              </p>
            )}

            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium">{section.title}</h2>
              <button
                onClick={() => moveSection(section, -1)}
                disabled={sIdx === 0}
                aria-label={`Move ${section.title} up`}
                title="Move section up"
                className="btn btn-quiet w-8 px-0"
              >
                ↑
              </button>
              <button
                onClick={() => moveSection(section, 1)}
                disabled={sIdx === serviceGroup.length - 1}
                aria-label={`Move ${section.title} down`}
                title="Move section down"
                className="btn btn-quiet w-8 px-0"
              >
                ↓
              </button>
              {items.length === 0 && (
                <button
                  onClick={() => removeSection(section)}
                  aria-label={`Remove ${section.title}`}
                  title="Remove empty section"
                  className="btn btn-quiet px-2 text-[var(--danger)]"
                >
                  ✕
                </button>
              )}
            </div>

            <ul className="mt-3 flex flex-col">
              {items.map((row, i) => (
                <li
                  key={row.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--surface-edge)] py-3 ${row.sold_out ? 'opacity-60' : ''}`}
                >
                  <div className="flex min-w-40 flex-1 items-center gap-2">
                    <input
                      value={row.name}
                      onChange={(e) =>
                        optimistic(row.id, { name: e.target.value }, () =>
                          updateMenuItem(getDb(), row.id, { name: e.target.value }),
                        )
                      }
                      className="field min-w-0 flex-1"
                    />
                    {row.sold_out && <span className="chip chip-off">Sold out</span>}
                  </div>

                  <input
                    value={row.note ?? ''}
                    placeholder="note"
                    onChange={(e) =>
                      optimistic(row.id, { note: e.target.value }, () =>
                        updateMenuItem(getDb(), row.id, { note: e.target.value }),
                      )
                    }
                    className="field min-w-40 flex-1 text-sm"
                  />

                  <input
                    inputMode="decimal"
                    value={String(row.price)}
                    onChange={(e) => {
                      const price = money(e.target.value);
                      if (Number.isNaN(price)) return;
                      optimistic(row.id, { price }, () =>
                        updateMenuItem(getDb(), row.id, { price }),
                      );
                    }}
                    className="field w-20"
                    aria-label={`Price of ${row.name}`}
                  />

                  <input
                    inputMode="decimal"
                    placeholder="mid"
                    value={row.price_mid === null ? '' : String(row.price_mid)}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const priceMid = raw ? money(raw) : 0;
                      if (raw && Number.isNaN(priceMid)) return;
                      optimistic(row.id, { price_mid: raw ? priceMid : null }, () =>
                        updateMenuItem(getDb(), row.id, { priceMid }),
                      );
                    }}
                    className="field w-20"
                    aria-label={`Middle price of ${row.name}`}
                  />

                  <input
                    inputMode="decimal"
                    placeholder="max"
                    value={row.price_max === null ? '' : String(row.price_max)}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const priceMax = raw ? money(raw) : 0;
                      if (raw && Number.isNaN(priceMax)) return;
                      optimistic(row.id, { price_max: raw ? priceMax : null }, () =>
                        updateMenuItem(getDb(), row.id, { priceMax }),
                      );
                    }}
                    className="field w-20"
                    aria-label={`Upper price of ${row.name}`}
                  />

                  <button
                    onClick={() => move(row, items, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${row.name} up`}
                    title="Move up"
                    className="btn btn-quiet w-9 px-0"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(row, items, 1)}
                    disabled={i === items.length - 1}
                    aria-label={`Move ${row.name} down`}
                    title="Move down"
                    className="btn btn-quiet w-9 px-0"
                  >
                    ↓
                  </button>

                  <button
                    onClick={() =>
                      optimistic(row.id, { sold_out: !row.sold_out }, () =>
                        updateMenuItem(getDb(), row.id, { soldOut: !row.sold_out }),
                      )
                    }
                    title={row.sold_out ? 'Put back on the menu' : 'Mark sold out'}
                    className="btn btn-quiet"
                  >
                    {row.sold_out ? 'Back on' : 'Sold out'}
                  </button>

                  <button onClick={() => remove(row)} className="btn btn-quiet" aria-label={`Delete ${row.name}`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            {adding === section.id ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Dish"
                  className="field min-w-40 flex-1"
                />
                <input
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder="note"
                  className="field min-w-40 flex-1"
                />
                <input
                  inputMode="decimal"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  placeholder="€"
                  className="field w-20"
                />
                <input
                  inputMode="decimal"
                  value={draft.priceMid}
                  onChange={(e) => setDraft({ ...draft, priceMid: e.target.value })}
                  placeholder="mid"
                  className="field w-20"
                />
                <input
                  inputMode="decimal"
                  value={draft.priceMax}
                  onChange={(e) => setDraft({ ...draft, priceMax: e.target.value })}
                  placeholder="max"
                  className="field w-20"
                />
                <button onClick={() => add(section.id)} className="btn btn-primary">
                  Add
                </button>
                <button
                  onClick={() => {
                    setAdding(null);
                    setDraft(BLANK);
                  }}
                  className="btn btn-quiet"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setAdding(section.id)} className="btn btn-quiet mt-3">
                Add to {section.title}
              </button>
            )}
          </section>
        );
      })}

      <div className="mt-12 border-t border-[var(--surface-edge)] pt-6">
        {addingSection ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={sectionDraft.title}
              onChange={(e) => setSectionDraft({ ...sectionDraft, title: e.target.value })}
              placeholder="New section, e.g. Land & sea"
              className="field min-w-48 flex-1"
            />
            <select
              value={sectionDraft.service}
              onChange={(e) => setSectionDraft({ ...sectionDraft, service: e.target.value as MenuService })}
              aria-label="Which service the section belongs to"
              className="field w-auto"
            >
              {(Object.keys(SERVICE_LABEL) as MenuService[]).map((s) => (
                <option key={s} value={s}>{SERVICE_LABEL[s]}</option>
              ))}
            </select>
            <button onClick={addSection} className="btn btn-primary">Add section</button>
            <button
              onClick={() => {
                setAddingSection(false);
                setSectionDraft(BLANK_SECTION);
              }}
              className="btn btn-quiet"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setAddingSection(true)} className="btn btn-quiet">
            + New section
          </button>
        )}
      </div>
    </main>
  );
}
