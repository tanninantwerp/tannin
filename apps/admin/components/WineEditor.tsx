'use client';

import { useCallback, useEffect, useState } from 'react';
import { createDrink } from '@tannin/supabase';
import type { DrinkCategory } from '@tannin/core';
import { getDb } from '@/lib/supabase';

type Colour = 'sparkling' | 'white' | 'orange' | 'rose' | 'red' | 'sweet';

/**
 * Which bar-list section a wine drops into when it goes by the glass. The bar
 * list has the same colour buckets as the cellar, bar one: there is no "sweet"
 * pour section, so a sweet wine has nowhere to land and the button stays hidden.
 */
const COLOUR_TO_BAR: Record<Colour, DrinkCategory | null> = {
  sparkling: 'sparkling',
  white: 'white',
  orange: 'orange',
  rose: 'rose',
  red: 'red',
  sweet: null,
};

interface Wine {
  id: string;
  name: string;
  producer: string;
  colour: Colour;
  country: string;
  region: string | null;
  vintage: number | null;
  glass: number | null;
  bottle: number;
  tasting_note: string | null;
  available: boolean;
  staff_pick: boolean;
  position: number;
}

/** In the order the cellar list runs, which is the order the page shows. */
const COLOURS: { key: Colour; label: string }[] = [
  { key: 'sparkling', label: 'Sparkling' },
  { key: 'white', label: 'White' },
  { key: 'orange', label: 'Orange' },
  { key: 'rose', label: 'Rosé' },
  { key: 'red', label: 'Red' },
  { key: 'sweet', label: 'Sweet' },
];

const BLANK = {
  producer: '',
  name: '',
  colour: 'red' as Colour,
  country: '',
  region: '',
  vintage: '',
  glass: '',
  bottle: '',
  tastingNote: '',
};

/**
 * The cellar list - 167 bottles, and until now the only part of the site with
 * no way to change it.
 *
 * That was the gap that mattered most: the whole point of this admin is to
 * replace a hosted menu nobody here controls, and a wine bar's wine list is
 * the page that changes most. A bottle running out on a Friday had to wait for
 * a developer.
 *
 * Deliberately not the same shape as the bar list. That screen is a short list
 * of pours in sections somebody arranges by hand. This is a long list where the
 * question is nearly always "find one bottle and change one number", so it
 * leads with search and keeps every field on the row.
 *
 * The row itself is two states, not one. Collapsed, it shows what you'd read a
 * label for - bottle, region and vintage, price, whether it's on the list -
 * because nine live inputs sitting open on every one of 167 rows is a wall of
 * near-identical controls, not a list. Tap it and the full field set opens,
 * same fields and same optimistic-save-on-blur behaviour as before.
 */
export function WineEditor() {
  const [wines, setWines] = useState<Wine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [colour, setColour] = useState<Colour | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  /** Wines added to the bar list this session, so the button can confirm it worked. */
  const [addedToBar, setAddedToBar] = useState<Set<string>>(new Set());

  /** One row open at a time, same reasoning as the password/rights boxes on People. */
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    // `*` rather than a fixed list, so tasting_note is read the moment its
    // migration lands, without this failing before it.
    const { data, error: err } = await getDb()
      .from('wines')
      .select('*')
      .order('colour')
      .order('position');

    if (err) setError(err.message);
    else setWines((data ?? []) as Wine[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Saves the one field that changed, on blur.
   *
   * Optimistic, because the alternative on a phone behind the bar is a Save
   * button per row and a hundred rows. If the write fails the message says so
   * and `load()` puts the real value back - nothing is silently kept.
   */
  async function patch(id: string, change: Partial<Wine>) {
    setWines((prev) => prev.map((w) => (w.id === id ? { ...w, ...change } : w)));
    const { error: err } = await getDb().from('wines').update(change).eq('id', id);
    if (err) {
      setError(err.message);
      load();
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const bottle = Number(draft.bottle);
    if (!Number.isFinite(bottle) || bottle <= 0) {
      setBusy(false);
      return setError('Give a bottle price.');
    }

    // Last in its colour, so a new bottle lands at the foot of its own section
    // rather than at the top of the whole list.
    const last = wines.filter((w) => w.colour === draft.colour).at(-1);

    const { error: err } = await getDb().from('wines').insert({
      producer: draft.producer.trim(),
      name: draft.name.trim(),
      colour: draft.colour,
      country: draft.country.trim(),
      region: draft.region.trim() || null,
      vintage: draft.vintage ? Number(draft.vintage) : null,
      glass: draft.glass ? Number(draft.glass) : null,
      bottle,
      ...(draft.tastingNote.trim() ? { tasting_note: draft.tastingNote.trim() } : {}),
      position: (last?.position ?? 0) + 1,
    });

    setBusy(false);
    if (err) return setError(err.message);
    setDraft(BLANK);
    setAdding(false);
    load();
  }

  /**
   * Swaps a wine with its neighbour in the same colour section.
   *
   * Within the colour, not within whatever `shown` currently is - a search or
   * a filter narrows what's visible, and reordering has to mean the same thing
   * whether or not a filter happens to be active. `position` only has to be
   * consistent within a colour to begin with: the public list groups by
   * colour first and reads position as the order inside that group.
   */
  async function move(wine: Wine, direction: -1 | 1) {
    const group = wines.filter((w) => w.colour === wine.colour).sort((a, b) => a.position - b.position);
    const idx = group.findIndex((w) => w.id === wine.id);
    const other = group[idx + direction];
    if (!other) return;

    const [a, b] = [wine.position, other.position];
    // Re-sorted, not just re-valued: a position swap that doesn't also move
    // the row in this array is invisible until the next load() re-fetches in
    // order - which reads as "did that even work" rather than a reorder.
    setWines((prev) => {
      const updated = prev.map((w) =>
        w.id === wine.id ? { ...w, position: b } : w.id === other.id ? { ...w, position: a } : w,
      );
      return updated.sort((x, y) =>
        x.colour === y.colour ? x.position - y.position : x.colour.localeCompare(y.colour),
      );
    });

    const [r1, r2] = await Promise.all([
      getDb().from('wines').update({ position: b }).eq('id', wine.id),
      getDb().from('wines').update({ position: a }).eq('id', other.id),
    ]);
    if (r1.error || r2.error) {
      setError((r1.error ?? r2.error)!.message);
      load();
    }
  }

  async function remove(wine: Wine) {
    if (!confirm(`Delete ${wine.producer} ${wine.name}? Marking it sold out is usually what you want.`)) {
      return;
    }
    setError(null);
    const { error: err } = await getDb().from('wines').delete().eq('id', wine.id);
    if (err) setError(err.message);
    load();
  }

  /**
   * Puts this bottle on the bar list by the glass. Copies producer, name,
   * origin and the glass price into the matching bar section - the bar list
   * then owns its own copy, so a later price move on one doesn't touch the
   * other. The button only shows once a glass price is set.
   */
  async function addToBar(wine: Wine) {
    const section = COLOUR_TO_BAR[wine.colour];
    if (!section || wine.glass == null) return;
    setError(null);
    try {
      await createDrink(getDb(), {
        sectionId: section,
        name: `${wine.producer} - ${wine.name}`,
        note: [wine.region, wine.country].filter(Boolean).join(', ') || undefined,
        price: wine.glass,
      });
      setAddedToBar((prev) => new Set(prev).add(wine.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add to the bar list.');
    }
  }

  if (loading) return <p className="p-8 text-[var(--fs-body)] text-[var(--text-muted)]">Loading the cellar…</p>;

  const needle = query.trim().toLowerCase();
  const shown = wines.filter((w) => {
    if (colour !== 'all' && w.colour !== colour) return false;
    if (!needle) return true;
    return `${w.producer} ${w.name} ${w.country} ${w.region ?? ''}`.toLowerCase().includes(needle);
  });

  return (
    <main className="admin-main">
      <h1 className="page-title">The wine list</h1>
      <p className="page-dek">
        {wines.length} bottles. Switching one to <strong>Sold out</strong> keeps it on the website,
        priced out, until it is back - delete it only if it is leaving the list for good.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-[var(--danger)] px-4 py-3 text-[var(--fs-body)] text-[var(--danger)]">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search producer, name, country…"
          aria-label="Search the wine list"
          className="field min-h-11 flex-1"
        />
        <select
          value={colour}
          onChange={(e) => setColour(e.target.value as Colour | 'all')}
          aria-label="Filter by colour"
          className="field min-h-11 w-auto"
        >
          <option value="all">All colours</option>
          {COLOURS.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <button onClick={() => setAdding(!adding)} className="btn btn-primary min-h-11 px-4">
          {adding ? 'Cancel' : 'Add a wine'}
        </button>
      </div>

      {adding && (
        <form onSubmit={add} className="card mt-4 grid gap-3 p-4 sm:grid-cols-3">
          <input required value={draft.producer} onChange={(e) => setDraft({ ...draft, producer: e.target.value })} placeholder="Producer" className="field min-h-11" />
          <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" className="field min-h-11" />
          <select value={draft.colour} onChange={(e) => setDraft({ ...draft, colour: e.target.value as Colour })} aria-label="Colour" className="field min-h-11">
            {COLOURS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <input required value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} placeholder="Country" className="field min-h-11" />
          <input value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} placeholder="Region (optional)" className="field min-h-11" />
          <input value={draft.vintage} onChange={(e) => setDraft({ ...draft, vintage: e.target.value })} placeholder="Vintage (optional)" inputMode="numeric" className="field min-h-11" />
          <input value={draft.glass} onChange={(e) => setDraft({ ...draft, glass: e.target.value })} placeholder="By the glass €" inputMode="decimal" className="field min-h-11" />
          <input required value={draft.bottle} onChange={(e) => setDraft({ ...draft, bottle: e.target.value })} placeholder="Bottle €" inputMode="decimal" className="field min-h-11" />
          <textarea value={draft.tastingNote} onChange={(e) => setDraft({ ...draft, tastingNote: e.target.value })} placeholder="Tasting note (optional) - how it tastes" rows={2} className="field sm:col-span-3" />
          <button type="submit" disabled={busy} className="btn btn-primary min-h-11">
            {busy ? 'Adding…' : 'Add to the list'}
          </button>
        </form>
      )}

      <p className="mt-5 text-[var(--fs-label)] text-[var(--text-muted)]">
        Showing {shown.length} of {wines.length}
      </p>

      <ul className="card mt-2 divide-y divide-[var(--surface-edge)]">
        {shown.map((wine) => {
          const isOpen = expanded === wine.id;
          const meta = [wine.country, wine.region, wine.vintage].filter(Boolean).join(' · ');
          const group = wines.filter((w) => w.colour === wine.colour).sort((a, b) => a.position - b.position);
          const groupIdx = group.findIndex((w) => w.id === wine.id);

          return (
            <li key={wine.id}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : wine.id)}
                aria-expanded={isOpen}
                className={`flex w-full min-h-11 items-center justify-between gap-3 p-3 text-left ${wine.available ? '' : 'opacity-60'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[var(--fs-emphasis)] font-medium">
                    {wine.producer} - {wine.name}
                  </span>
                  {meta && <span className="mt-0.5 block truncate text-[var(--fs-label)] text-[var(--text-muted)]">{meta}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {wine.staff_pick && <span aria-hidden className="text-[var(--accent)]">★</span>}
                  <span className="text-[var(--fs-emphasis)] font-semibold tabular-nums">€{wine.bottle}</span>
                  <span className={`chip ${wine.available ? 'chip-on' : 'chip-off'}`}>
                    {wine.available ? 'On list' : 'Sold out'}
                  </span>
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-[var(--surface-edge)] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={wine.producer}
                      onChange={(e) => setWines((p) => p.map((w) => (w.id === wine.id ? { ...w, producer: e.target.value } : w)))}
                      onBlur={(e) => patch(wine.id, { producer: e.target.value })}
                      aria-label={`Producer of ${wine.name}`}
                      className="field min-h-11 min-w-40 flex-1"
                    />
                    <input
                      value={wine.name}
                      onChange={(e) => setWines((p) => p.map((w) => (w.id === wine.id ? { ...w, name: e.target.value } : w)))}
                      onBlur={(e) => patch(wine.id, { name: e.target.value })}
                      aria-label={`Name of ${wine.producer} wine`}
                      className="field min-h-11 min-w-40 flex-1"
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={wine.colour}
                      onChange={(e) => patch(wine.id, { colour: e.target.value as Colour })}
                      aria-label={`Colour of ${wine.producer} ${wine.name}`}
                      className="field min-h-11 w-auto"
                    >
                      {COLOURS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <input
                      value={wine.country}
                      onChange={(e) => setWines((p) => p.map((w) => (w.id === wine.id ? { ...w, country: e.target.value } : w)))}
                      onBlur={(e) => patch(wine.id, { country: e.target.value })}
                      aria-label={`Country of ${wine.producer} ${wine.name}`}
                      className="field min-h-11 w-28"
                    />
                    <input
                      value={wine.region ?? ''}
                      onChange={(e) => setWines((p) => p.map((w) => (w.id === wine.id ? { ...w, region: e.target.value } : w)))}
                      onBlur={(e) => patch(wine.id, { region: e.target.value || null })}
                      placeholder="Region"
                      aria-label={`Region of ${wine.producer} ${wine.name}`}
                      className="field min-h-11 w-32"
                    />
                    <input
                      value={wine.vintage ?? ''}
                      inputMode="numeric"
                      onChange={(e) => setWines((p) => p.map((w) => (w.id === wine.id ? { ...w, vintage: e.target.value ? Number(e.target.value) : null } : w)))}
                      onBlur={(e) => patch(wine.id, { vintage: e.target.value ? Number(e.target.value) : null })}
                      placeholder="Year"
                      aria-label={`Vintage of ${wine.producer} ${wine.name}`}
                      className="field min-h-11 w-20"
                    />

                    <label className="flex items-center gap-1 text-[var(--fs-label)] text-[var(--text-muted)]">
                      Glass €
                      <input
                        value={wine.glass ?? ''}
                        inputMode="decimal"
                        onChange={(e) => setWines((p) => p.map((w) => (w.id === wine.id ? { ...w, glass: e.target.value ? Number(e.target.value) : null } : w)))}
                        onBlur={(e) => patch(wine.id, { glass: e.target.value ? Number(e.target.value) : null })}
                        aria-label={`Glass price of ${wine.producer} ${wine.name}`}
                        className="field min-h-11 w-20"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[var(--fs-label)] text-[var(--text-muted)]">
                      Bottle €
                      <input
                        value={wine.bottle}
                        inputMode="decimal"
                        onChange={(e) => setWines((p) => p.map((w) => (w.id === wine.id ? { ...w, bottle: Number(e.target.value) } : w)))}
                        onBlur={(e) => patch(wine.id, { bottle: Number(e.target.value) })}
                        aria-label={`Bottle price of ${wine.producer} ${wine.name}`}
                        className="field min-h-11 w-20"
                      />
                    </label>

                    <button
                      onClick={() => move(wine, -1)}
                      disabled={groupIdx <= 0}
                      title={`Move up within ${COLOURS.find((c) => c.key === wine.colour)?.label ?? wine.colour}`}
                      aria-label={`Move ${wine.producer} ${wine.name} up`}
                      className="btn btn-quiet min-h-11 w-11 px-0"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(wine, 1)}
                      disabled={groupIdx >= group.length - 1}
                      title={`Move down within ${COLOURS.find((c) => c.key === wine.colour)?.label ?? wine.colour}`}
                      aria-label={`Move ${wine.producer} ${wine.name} down`}
                      className="btn btn-quiet min-h-11 w-11 px-0"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => patch(wine.id, { available: !wine.available })}
                      title={wine.available ? 'Mark sold out' : 'Put back on the list'}
                      className="btn btn-quiet min-h-11 px-4"
                    >
                      {wine.available ? 'Sold out' : 'Back on'}
                    </button>
                    <button
                      onClick={() => patch(wine.id, { staff_pick: !wine.staff_pick })}
                      title="Staff pick"
                      className={`btn btn-quiet min-h-11 px-4 ${wine.staff_pick ? 'text-[var(--accent)]' : ''}`}
                    >
                      {wine.staff_pick ? '★ Pick' : '☆ Pick'}
                    </button>
                    {wine.glass != null && COLOUR_TO_BAR[wine.colour] && (
                      <button
                        onClick={() => addToBar(wine)}
                        disabled={addedToBar.has(wine.id)}
                        title={`Add ${wine.producer} ${wine.name} to the bar list by the glass at €${wine.glass}`}
                        className="btn btn-quiet min-h-11 px-4"
                      >
                        {addedToBar.has(wine.id) ? 'On the bar ✓' : '+ Bar list'}
                      </button>
                    )}
                    <button onClick={() => remove(wine)} className="btn btn-quiet min-h-11 px-3 text-[var(--danger)]">
                      Delete
                    </button>
                  </div>

                  <textarea
                    value={wine.tasting_note ?? ''}
                    onChange={(e) => setWines((p) => p.map((w) => (w.id === wine.id ? { ...w, tasting_note: e.target.value } : w)))}
                    onBlur={(e) => patch(wine.id, { tasting_note: e.target.value.trim() || null })}
                    placeholder="Tasting note - how it tastes (shown on the website)"
                    aria-label={`Tasting note for ${wine.producer} ${wine.name}`}
                    rows={2}
                    className="field mt-2 w-full"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {shown.length === 0 && (
        <p className="mt-4 text-[var(--fs-body)] text-[var(--text-muted)]">Nothing matches that.</p>
      )}
    </main>
  );
}
