'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDb } from '@/lib/supabase';

type Category = 'wine' | 'drink' | 'food';

interface Item {
  id: string;
  category: Category;
  name: string;
  unit: string | null;
  note: string | null;
  position: number;
  verified: boolean;
  archived: boolean;
  supplier_id: string | null;
}

interface HistoryEntry {
  id: string;
  created_at: string;
  printed_at: string | null;
  emailed_at: string | null;
  recipient: string | null;
  created_by_name: string | null;
  line_count: number;
  category: 'wine' | 'drink' | 'food' | null;
  lines: {
    label: string;
    rows: { item_id?: string; name: string; unit: string | null; note: string | null; quantity: number }[];
  }[];
}

interface Supplier {
  id: string;
  name: string;
  note: string | null;
  position: number;
}

interface ListRow {
  id: string;
  order_item_id: string;
  quantity: number;
  /** On the list, but not on this trip. Only ticked rows print or get mailed. */
  checked: boolean;
}

const TABS: { key: Category; label: string }[] = [
  { key: 'wine', label: 'Wines' },
  { key: 'drink', label: 'Drinks' },
  { key: 'food', label: 'Food' },
];

const CATEGORY_LABEL: Record<Category, string> = {
  wine: 'Wines',
  drink: 'Drinks',
  food: 'Food',
};

const BLANK = { name: '', unit: '', note: '', supplierId: '' };

const WHEN = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Brussels',
});

/**
 * The buying screen: a catalogue of everything the bar and kitchen order, and
 * the list being built out of it.
 *
 * Two lists rather than one, because what you buy is not what you sell. The
 * catalogue is the standing list of products; the shopping list is this week's
 * quantities against them. Adding the same product twice raises its quantity
 * instead of repeating the line, which is enforced by a unique constraint
 * rather than trusted to the UI.
 *
 * Wines and bar stock were seeded from rows the venue already keeps, so they
 * are marked verified. Food ingredients and cocktail components were not - the
 * menu records a dish name and a garnish note, never a recipe - so they are
 * seeded from the standard build of each dish and flagged "check" until
 * somebody who cooks it says otherwise. That flag is the whole point: it is the
 * difference between a list the kitchen owns and a guess that looks like one.
 */
export function OrderEditor() {
  const [category, setCategory] = useState<Category>('wine');
  const [items, setItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [supplierDraft, setSupplierDraft] = useState({ name: '', note: '' });
  const [list, setList] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(BLANK);

  const [cellarMissing, setCellarMissing] = useState<number>(0);
  const [syncing, setSyncing] = useState(false);

  /** The order filed for this list, once finalised. Print and email act on it. */
  const [finalised, setFinalised] = useState<HistoryEntry | null>(null);
  const [finalising, setFinalising] = useState(false);

  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ ok: boolean; text: string } | null>(null);

  /** The label the migration gives a bottle, so sync and seed agree. */
  const wineLabel = (w: { producer: string; name: string | null }) =>
    w.name && w.name !== w.producer ? `${w.producer} - ${w.name}` : w.producer;

  const load = useCallback(async () => {
    setLoading(true);
    const [a, b, c, d, e] = await Promise.all([
      getDb().from('order_items').select('*').eq('archived', false).order('position'),
      getDb().from('order_list_items').select('id, order_item_id, quantity, checked'),
      getDb().from('app_settings').select('value').eq('key', 'order_email').maybeSingle(),
      getDb().from('order_suppliers').select('id, name, note, position').eq('archived', false).order('position'),
      // Enough to cover a season of ordering without paging.
      getDb()
        .from('order_history')
        .select('id, created_at, printed_at, emailed_at, recipient, created_by_name, line_count, lines, category')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    if (a.error) setError(a.error.message);
    else {
      setItems((a.data ?? []) as Item[]);
      setList((b.data ?? []) as ListRow[]);
      if (c.data?.value) setEmail(c.data.value as string);
      setSuppliers((d.data ?? []) as Supplier[]);
      setHistory((e.data ?? []) as HistoryEntry[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  /**
   * How many bottles in the cellar have no catalogue row yet.
   *
   * The wine catalogue is seeded from `wines` once, by the migration, which
   * leaves it a snapshot: a bottle added in the Wine screen next month would
   * never reach the buyer's list. Rather than keep the two in step with a
   * trigger - and silently re-add wines the buyer has deliberately removed -
   * the drift is surfaced and the buyer decides.
   */
  const checkCellar = useCallback(async (existing: Item[]) => {
    const { data } = await getDb().from('wines').select('producer, name');
    if (!data) return;
    const have = new Set(existing.filter((i) => i.category === 'wine').map((i) => i.name));
    setCellarMissing(data.filter((w) => !have.has(wineLabel(w as never))).length);
  }, []);

  useEffect(() => {
    if (items.length) void checkCellar(items);
  }, [items, checkCellar]);

  async function syncCellar() {
    setSyncing(true);
    const { data } = await getDb()
      .from('wines')
      .select('producer, name, vintage, region, country, colour, position')
      .order('colour')
      .order('position');
    const have = new Set(items.filter((i) => i.category === 'wine').map((i) => i.name));
    let position = Math.max(0, ...items.filter((i) => i.category === 'wine').map((i) => i.position));
    const rows = (data ?? [])
      .filter((w) => !have.has(wineLabel(w as never)))
      .map((w) => ({
        category: 'wine' as const,
        name: wineLabel(w as never),
        unit: 'bottle',
        note: [w.vintage, w.region, w.country].filter(Boolean).join(' · ') || null,
        position: ++position,
        verified: true,
      }));
    if (rows.length) {
      const { data: added, error } = await getDb().from('order_items').insert(rows).select('*');
      if (error) setError(error.message);
      else if (added) setItems((p) => [...p, ...(added as Item[])]);
    }
    setCellarMissing(0);
    setSyncing(false);
  }

  useEffect(() => {
    void load();
  }, [load]);

  const inCategory = useMemo(
    () => items.filter((i) => i.category === category).sort((x, y) => x.position - y.position),
    [items, category],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inCategory;
    return inCategory.filter((i) =>
      [i.name, i.unit, i.note].filter(Boolean).some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [inCategory, query]);

  const qtyFor = useCallback(
    (itemId: string) => list.find((l) => l.order_item_id === itemId)?.quantity ?? 0,
    [list],
  );

  /**
   * This tab's list, and only this tab's.
   *
   * Three lists rather than one basket: the cellar, the bar and the kitchen are
   * ordered separately, by different people, on different days, so each tab
   * keeps and sends its own. A line belongs to a list through the product it
   * points at, so nothing needs to store the category twice.
   */
  useEffect(() => {
    setFinalised(null);
    setEmailOpen(false);
    setSent(null);
  }, [category]);

  const listRows = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    return list
      .map((l) => ({ ...l, item: byId.get(l.order_item_id) }))
      .filter((r): r is ListRow & { item: Item } => !!r.item && r.item.category === category)
      .sort((a, b) => a.item.position - b.item.position);
  }, [items, list, category]);

  /**
   * The ticked rows only, which is what printing and mailing use.
   *
   * Separate from `listRows` rather than a filter at each call site: the screen
   * shows everything gathered so far, including what has been set aside while
   * the order is being put together, and the sheet shows only what is actually
   * being bought. Conflating the two is how somebody ends up with a printout of
   * things they deliberately skipped.
   */
  const checkedRows = useMemo(() => listRows.filter((r) => r.checked), [listRows]);

  const supplierName = useCallback(
    (id: string | null) => suppliers.find((x) => x.id === id)?.name ?? null,
    [suppliers],
  );

  /**
   * How the sheet is grouped.
   *
   * By supplier as soon as anything has one, because an order is placed per
   * supplier - you send Horeca Totaal their list, not "the drinks". Until any
   * are assigned that would be one big "Not assigned" heading, which is worse
   * than the category split, so it only switches once it would help.
   */
  const printGroups = useMemo(() => {
    if (checkedRows.length === 0) return [];
    const anySupplier = checkedRows.some((r) => r.item.supplier_id);
    if (!anySupplier) {
      return [{ key: category, label: CATEGORY_LABEL[category], rows: checkedRows }];
    }
    const names = [...suppliers].sort((a, b) => a.position - b.position).map((x) => x.name);
    return [...names, null]
      .map((name) => ({
        key: name ?? 'unassigned',
        label: name ?? 'Not assigned to a supplier',
        rows: checkedRows.filter((r) => (supplierName(r.item.supplier_id) ?? null) === name),
      }))
      .filter((g) => g.rows.length > 0);
  }, [checkedRows, suppliers, supplierName, category]);

  const listCount = listRows.length;
  const checkedCount = checkedRows.length;

  // ── the shopping list ──────────────────────────────────────────────────────

  async function addToList(item: Item, quantity: number) {
    // The filed order described the basket as it was; it no longer does.
    setFinalised(null);
    if (!(quantity > 0)) return;
    const existing = list.find((l) => l.order_item_id === item.id);
    if (existing) {
      const next = existing.quantity + quantity;
      setList((p) => p.map((l) => (l.id === existing.id ? { ...l, quantity: next } : l)));
      const { error } = await getDb().from('order_list_items').update({ quantity: next }).eq('id', existing.id);
      if (error) setError(error.message);
      return;
    }
    const { data, error } = await getDb()
      .from('order_list_items')
      .insert({ order_item_id: item.id, quantity })
      .select('id, order_item_id, quantity, checked')
      .single();
    if (error) setError(error.message);
    else if (data) setList((p) => [...p, data as ListRow]);
  }

  async function setQuantity(row: ListRow, quantity: number) {
    // The filed order described the basket as it was; it no longer does.
    setFinalised(null);
    if (!(quantity > 0)) return removeFromList(row);
    setList((p) => p.map((l) => (l.id === row.id ? { ...l, quantity } : l)));
    const { error } = await getDb().from('order_list_items').update({ quantity }).eq('id', row.id);
    if (error) setError(error.message);
  }

  async function toggleChecked(row: ListRow) {
    // The filed order described the basket as it was; it no longer does.
    setFinalised(null);
    const checked = !row.checked;
    setList((p) => p.map((l) => (l.id === row.id ? { ...l, checked } : l)));
    const { error } = await getDb().from('order_list_items').update({ checked }).eq('id', row.id);
    if (error) setError(error.message);
  }

  async function removeFromList(row: ListRow) {
    // The filed order described the basket as it was; it no longer does.
    setFinalised(null);
    setList((p) => p.filter((l) => l.id !== row.id));
    const { error } = await getDb().from('order_list_items').delete().eq('id', row.id);
    if (error) setError(error.message);
  }

  async function clearList() {
    const ids = listRows.map((r) => r.id);
    if (ids.length === 0) return;
    if (!confirm(`Clear the ${CATEGORY_LABEL[category].toLowerCase()} list? The other lists and the catalogue are not touched.`)) return;
    setList((p) => p.filter((l) => !ids.includes(l.id)));
    const { error } = await getDb().from('order_list_items').delete().in('id', ids);
    if (error) setError(error.message);
  }

  // ── the catalogue ──────────────────────────────────────────────────────────

  async function createItem() {
    const name = draft.name.trim();
    if (!name) return;
    const position = Math.max(0, ...inCategory.map((i) => i.position)) + 1;
    const row = {
      category,
      name,
      unit: draft.unit.trim() || null,
      note: draft.note.trim() || null,
      position,
      supplier_id: draft.supplierId || null,
      // Typed in by a person who buys the thing, so it is not a guess.
      verified: true,
    };
    const { data, error } = await getDb().from('order_items').insert(row).select('*').single();
    if (error) setError(error.message);
    else if (data) {
      setItems((p) => [...p, data as Item]);
      setDraft(BLANK);
      setAdding(false);
    }
  }

  async function saveEdit(item: Item) {
    const name = editDraft.name.trim();
    if (!name) return;
    const patch = {
      name,
      unit: editDraft.unit.trim() || null,
      note: editDraft.note.trim() || null,
      supplier_id: editDraft.supplierId || null,
      // Correcting a seeded row is exactly the act that confirms it.
      verified: true,
    };
    setItems((p) => p.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    setEditing(null);
    const { error } = await getDb().from('order_items').update(patch).eq('id', item.id);
    if (error) setError(error.message);
  }

  /**
   * Archived, not deleted: a product that falls off the list this season is
   * usually back next one, and anything already on a shopping list would
   * otherwise vanish from under the buyer.
   */
  async function archive(item: Item) {
    if (!confirm(`Remove "${item.name}" from the ${CATEGORY_LABEL[item.category].toLowerCase()} list?`)) return;
    setItems((p) => p.filter((i) => i.id !== item.id));
    setList((p) => p.filter((l) => l.order_item_id !== item.id));
    const { error } = await getDb().from('order_items').update({ archived: true }).eq('id', item.id);
    if (error) setError(error.message);
  }

  /** Swap with the neighbour, and re-sort - a position swap alone would not move the row. */
  async function move(item: Item, direction: -1 | 1) {
    const ordered = inCategory;
    const index = ordered.findIndex((i) => i.id === item.id);
    const other = ordered[index + direction];
    if (!other) return;
    const [a, b] = [item.position, other.position];
    setItems((prev) =>
      prev
        .map((i) => (i.id === item.id ? { ...i, position: b } : i.id === other.id ? { ...i, position: a } : i))
        .sort((x, y) => x.position - y.position),
    );
    const [r1, r2] = await Promise.all([
      getDb().from('order_items').update({ position: b }).eq('id', item.id),
      getDb().from('order_items').update({ position: a }).eq('id', other.id),
    ]);
    if (r1.error || r2.error) setError((r1.error ?? r2.error)!.message);
  }

  async function createSupplier() {
    const name = supplierDraft.name.trim();
    if (!name) return;
    const position = Math.max(0, ...suppliers.map((x) => x.position)) + 1;
    const { data, error } = await getDb()
      .from('order_suppliers')
      .insert({ name, note: supplierDraft.note.trim() || null, position })
      .select('id, name, note, position')
      .single();
    if (error) setError(error.message);
    else if (data) {
      setSuppliers((p) => [...p, data as Supplier]);
      setSupplierDraft({ name: '', note: '' });
    }
  }


  /**
   * File the order, once.
   *
   * Printing and mailing used to file a record each, so an order printed for
   * the trolley and mailed to the buyer showed up twice thirty seconds apart,
   * looking like two orders. The log answers "what did we order", and that is
   * one order however many ways it came out. So it is filed here, deliberately,
   * and the two outputs stamp this same row.
   *
   * The snapshot is stored rather than references into the catalogue, which
   * keeps moving underneath it - products get renamed, reassigned, archived -
   * and a record that rewrites itself answers nothing. It is also what print
   * and email render, so the sheet cannot drift from what the log says was
   * ordered while somebody is still fiddling with the basket.
   */
  async function finaliseOrder() {
    if (checkedRows.length === 0) return;
    setFinalising(true);
    const lines = printGroups.map((g) => ({
      label: g.label,
      rows: g.rows.map((r) => ({
        // The id is what lets a filed list be loaded back into the basket. The
        // name and unit are kept beside it because the product may since have
        // been renamed or archived, and the record must still read as it went.
        item_id: r.item.id,
        name: r.item.name,
        unit: r.item.unit,
        note: r.item.note,
        quantity: r.quantity,
      })),
    }));
    const line_count = lines.reduce((n, g) => n + g.rows.length, 0);
    const { data, error } = await getDb()
      .from('order_history')
      .insert({ lines, line_count, category })
      .select('id, created_at, printed_at, emailed_at, recipient, created_by_name, line_count, lines, category')
      .single();
    if (error) setError(error.message);
    else if (data) {
      const entry = data as HistoryEntry;
      setFinalised(entry);
      setHistory((p) => [entry, ...p]);

      /*
       * The list empties.
       *
       * A filed order is finished, and leaving it in the basket invites
       * somebody to send last week's order again without noticing they never
       * revised it. Starting empty makes each order a deliberate act.
       *
       * Nothing is lost by it: the order is in the log, and Use again puts it
       * straight back when this week's shop is last week's shop with different
       * numbers - which is most weeks. That is the same starting point, fetched
       * on purpose rather than left lying about.
       *
       * Deleted directly rather than through removeFromList, which clears the
       * filed order by design - here the order is the one just filed, and print
       * and email still render from it.
       */
      const ids = listRows.map((r) => r.id);
      setList((p) => p.filter((l) => !ids.includes(l.id)));
      const { error: clearError } = await getDb().from('order_list_items').delete().in('id', ids);
      if (clearError) setError(clearError.message);

      setSent({
        ok: true,
        text: `Order filed - ${line_count} lines. Print or email it below. The list is cleared; Use again in History brings it back.`,
      });
    }
    setFinalising(false);
  }

  /** Stamp the filed order with how it left, without filing a second one. */
  async function stamp(patch: { printed_at?: string; emailed_at?: string; recipient?: string }) {
    if (!finalised) return;
    const { data, error } = await getDb()
      .from('order_history')
      .update(patch)
      .eq('id', finalised.id)
      .select('id, created_at, printed_at, emailed_at, recipient, created_by_name, line_count, lines, category')
      .single();
    if (error) setError(error.message);
    else if (data) {
      const entry = data as HistoryEntry;
      setFinalised(entry);
      setHistory((p) => p.map((h) => (h.id === entry.id ? entry : h)));
    }
  }

  /**
   * Put a filed list back on the basket.
   *
   * Most weeks' shop is last week's shop, so this is the shortest path to a
   * new order. Resolved by product id first and by name only as a fallback,
   * because a renamed product is still the same thing to buy while two
   * products can share a name.
   *
   * Quantities overwrite rather than add: "use again" means order that, not
   * order twice as much as that. Anything since archived is skipped and
   * counted, so the buyer is told rather than quietly given a shorter list.
   */
  async function reuse(h: HistoryEntry) {
    const rows = h.lines.flatMap((g) => g.rows);
    const byId = new Map(items.map((i) => [i.id, i]));
    const byName = new Map(items.map((i) => [i.name.toLowerCase(), i]));
    const resolved = rows.map((r) => ({
      item: (r.item_id ? byId.get(r.item_id) : undefined) ?? byName.get(r.name.toLowerCase()),
      quantity: r.quantity,
    }));
    const found = resolved.filter((x): x is { item: Item; quantity: number } => Boolean(x.item));
    const gone = resolved.length - found.length;
    if (found.length === 0) {
      setError('None of those products are on the catalogue any more.');
      return;
    }

    const { error } = await getDb()
      .from('order_list_items')
      .upsert(
        found.map((x) => ({ order_item_id: x.item.id, quantity: x.quantity, checked: true })),
        { onConflict: 'order_item_id' },
      );
    if (error) {
      setError(error.message);
      return;
    }

    const { data } = await getDb().from('order_list_items').select('id, order_item_id, quantity, checked');
    setList((data ?? []) as ListRow[]);
    if (h.category) setCategory(h.category);
    setHistoryOpen(false);
    setSent({
      ok: true,
      text: gone > 0
        ? `${found.length} back on the list. ${gone} no longer in the catalogue.`
        : `${found.length} back on the list.`,
    });
  }

  /**
   * Printed when the sheet is generated, which is when the buyer acted on it.
   * Whether paper actually came out of the printer is not something the page
   * is told, so a cancelled dialog still leaves a record - the alternative is
   * losing the ones that did print.
   */
  async function printList() {
    if (!finalised) return;
    window.print();
    // Stamped after the dialog opens rather than on some later confirmation:
    // a browser never tells the page whether paper actually came out, and
    // losing the ones that did print is the worse error.
    await stamp({ printed_at: new Date().toISOString() });
  }

  // ── print and email ────────────────────────────────────────────────────────

  async function sendEmail() {
    const to = email.trim();
    if (!to) return;
    setSending(true);
    setSent(null);
    const payload = {
      to,
      // The filed snapshot, not the live basket, so the mail matches the log.
      groups: finalised?.lines ?? [],
    };
    try {
      const { data: session } = await getDb().auth.getSession();
      const res = await fetch('/api/order/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.session?.access_token ?? ''}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (res.ok && body.sent) {
        await stamp({ emailed_at: new Date().toISOString(), recipient: to });
        setSent({ ok: true, text: `Sent to ${to}.` });
        setEmailOpen(false);
      } else {
        setSent({ ok: false, text: body.error ?? 'Could not send that.' });
      }
    } catch {
      setSent({ ok: false, text: 'Could not reach the mail server.' });
    }
    setSending(false);
  }

  if (loading) return <p className="p-6 text-sm text-[var(--text-muted)]">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">Order</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Build a shopping list, then print it or mail it to yourself.
      </p>

      {error && (
        <p className="mt-4 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {/* The three lists. */}
      <div role="tablist" aria-label="Which list" className="mt-5 flex gap-1 rounded-2xl border border-[var(--surface-edge)] p-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={category === key}
            onClick={() => setCategory(key)}
            className={`min-h-11 flex-1 rounded-full px-4 text-[0.75rem] font-semibold uppercase tracking-[0.12em] transition-colors ${
              category === key
                ? 'bg-[var(--color-green-deep,#2f5d59)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Print and mail sit above the list, and cover the whole basket rather
          than the open tab - a shopping trip is one trip, not three. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this list…"
          aria-label={`Search the ${CATEGORY_LABEL[category].toLowerCase()} list`}
          className="min-h-11 min-w-48 flex-1 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
        />
        {/* Filing the order and sending it are separate acts, so an order that
            is both printed and mailed is still one order in the log. */}
        <button
          onClick={finaliseOrder}
          disabled={checkedCount === 0 || finalising || !!finalised}
          className="btn btn-primary min-h-11 px-4"
        >
          {finalised ? 'Order filed' : finalising ? 'Filing…' : 'Finalise order'}
        </button>
        <button
          onClick={printList}
          disabled={!finalised}
          title={finalised ? undefined : 'Finalise the order first'}
          className="btn btn-quiet min-h-11 px-4"
        >
          Print
        </button>
        <button
          onClick={() => setEmailOpen((v) => !v)}
          disabled={!finalised}
          title={finalised ? undefined : 'Finalise the order first'}
          className="btn btn-quiet min-h-11 px-4"
        >
          Email
        </button>
        <button onClick={() => setHistoryOpen((v) => !v)} className="btn btn-quiet min-h-11 px-4">
          History{history.length > 0 ? ` (${history.length})` : ''}
        </button>
        <button onClick={() => setSuppliersOpen((v) => !v)} className="btn btn-quiet min-h-11 px-4">
          Suppliers
        </button>
        <button onClick={() => setAdding((v) => !v)} className="btn btn-primary min-h-11 px-4">
          Add product
        </button>
      </div>

      {category === 'wine' && cellarMissing > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="flex-1 text-sm text-amber-900">
            {cellarMissing} {cellarMissing === 1 ? 'bottle is' : 'bottles are'} in the cellar but not on this list.
          </p>
          <button onClick={syncCellar} disabled={syncing} className="btn btn-quiet min-h-11 px-4">
            {syncing ? 'Adding…' : 'Add them'}
          </button>
        </div>
      )}

      {historyOpen && (
        <div className="mt-3 rounded-sm border border-[var(--surface-edge)] p-3">
          <p className="text-[0.7rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Lists sent and printed
          </p>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Nothing yet. Printing or emailing a list files a copy here.
            </p>
          ) : (
            <ul className="mt-2">
              {history.map((h) => (
                <li key={h.id} className="border-b border-[var(--surface-edge)] py-2 last:border-0">
                  <button
                    onClick={() => setOpenEntry(openEntry === h.id ? null : h.id)}
                    aria-expanded={openEntry === h.id}
                    className="flex w-full items-baseline gap-2 text-left"
                  >
                    <span className="text-sm tabular-nums">{WHEN.format(new Date(h.created_at))}</span>
                    {h.category && (
                      <span className="rounded-full border border-[var(--surface-edge)] px-2 text-[0.66rem] uppercase tracking-[0.1em]">
                        {CATEGORY_LABEL[h.category]}
                      </span>
                    )}
                    <span className="text-[0.72rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                      {[h.printed_at && 'printed', h.emailed_at && 'emailed'].filter(Boolean).join(' · ') || 'filed'}
                    </span>
                    {h.recipient && (
                      <span className="text-[0.75rem] text-[var(--text-muted)]">{h.recipient}</span>
                    )}
                    <span className="ml-auto text-[0.75rem] text-[var(--text-muted)]">
                      {h.line_count} {h.line_count === 1 ? 'line' : 'lines'}
                    </span>
                  </button>
                  <div className="flex items-baseline gap-3">
                    {h.created_by_name && (
                      <p className="text-[0.72rem] text-[var(--text-muted)]">by {h.created_by_name}</p>
                    )}
                    <button onClick={() => reuse(h)} className="btn btn-quiet min-h-11 px-3 text-[0.7rem]">
                      Use again
                    </button>
                  </div>

                  {/* The list exactly as it went out, not as the catalogue reads today. */}
                  {openEntry === h.id && (
                    <div className="mt-2 border-l-2 border-[var(--surface-edge)] pl-3">
                      {h.lines.map((g, gi) => (
                        <div key={gi} className="mt-2 first:mt-0">
                          <p className="text-[0.66rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                            {g.label}
                          </p>
                          <ul>
                            {g.rows.map((r, ri) => (
                              <li key={ri} className="text-[0.82rem]">
                                <span className="tabular-nums">{r.quantity}</span>
                                {r.unit ? ` ${r.unit}` : ''} · {r.name}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {suppliersOpen && (
        <div className="mt-3 rounded-sm border border-[var(--surface-edge)] p-3">
          <p className="text-[0.7rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">Suppliers</p>
          <ul className="mt-2">
            {suppliers.map((sup) => (
              <li key={sup.id} className="flex items-baseline gap-2 border-b border-[var(--surface-edge)] py-1.5 text-sm last:border-0">
                <span>{sup.name}</span>
                {sup.note && <span className="text-[0.75rem] text-[var(--text-muted)]">{sup.note}</span>}
                <span className="ml-auto text-[0.72rem] text-[var(--text-muted)]">
                  {items.filter((i) => i.supplier_id === sup.id).length} products
                </span>
              </li>
            ))}
          </ul>
          {/* Names get added as the buyer learns them - only three are known so far. */}
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              value={supplierDraft.name}
              onChange={(e) => setSupplierDraft({ ...supplierDraft, name: e.target.value })}
              placeholder="New supplier"
              className="min-h-11 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
            />
            <input
              value={supplierDraft.note}
              onChange={(e) => setSupplierDraft({ ...supplierDraft, note: e.target.value })}
              placeholder="What they deliver"
              className="min-h-11 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
            />
            <button onClick={createSupplier} disabled={!supplierDraft.name.trim()} className="btn btn-primary min-h-11 px-4">
              Add
            </button>
          </div>
        </div>
      )}

      {emailOpen && (
        <div className="mt-3 rounded-sm border border-[var(--surface-edge)] p-3">
          <label className="block text-[0.7rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Send the list to
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="min-h-11 min-w-56 flex-1 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
            />
            <button onClick={sendEmail} disabled={sending || !email.trim()} className="btn btn-primary min-h-11 px-4">
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
          {/* Kept for next time, so the buyer types it once. */}
          <p className="mt-2 text-[0.75rem] text-[var(--text-muted)]">
            This address is remembered for the next order.
          </p>
        </div>
      )}
      {sent && (
        <p className={`mt-2 text-sm ${sent.ok ? 'text-green-700' : 'text-red-700'}`}>{sent.text}</p>
      )}

      {adding && (
        <div className="mt-3 rounded-sm border border-[var(--surface-edge)] p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name"
              className="min-h-11 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
            />
            <input
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              placeholder="Unit (kg, crate…)"
              className="min-h-11 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
            />
            <input
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder="Note"
              className="min-h-11 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
            />
            <select
              value={draft.supplierId}
              onChange={(e) => setDraft({ ...draft, supplierId: e.target.value })}
              aria-label="Supplier"
              className="min-h-11 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
            >
              <option value="">Supplier…</option>
              {suppliers.map((sup) => (
                <option key={sup.id} value={sup.id}>{sup.name}</option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={createItem} disabled={!draft.name.trim()} className="btn btn-primary min-h-11 px-4">
              Add to {CATEGORY_LABEL[category].toLowerCase()}
            </button>
            <button onClick={() => { setAdding(false); setDraft(BLANK); }} className="btn btn-quiet min-h-11 px-4">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* The basket, first, because it is the thing being built. */}
      {listCount > 0 && (
        <section className="mt-6 rounded-sm border border-[var(--surface-edge)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
              {CATEGORY_LABEL[category]} list ({checkedCount} of {listCount} to buy)
            </h2>
            <button onClick={clearList} className="btn btn-quiet min-h-11 px-3 text-[0.7rem]">
              Clear
            </button>
          </div>
          <div className="mt-3">
              <ul className="mt-1">
                {listRows.map((r) => (
                  <li key={r.id} className={`flex items-center gap-2 border-b border-[var(--surface-edge)] py-2 last:border-0 ${r.checked ? '' : 'opacity-45'}`}>
                    <input
                      type="checkbox"
                      checked={r.checked}
                      onChange={() => toggleChecked(r)}
                      aria-label={`Buy ${r.item.name} on this order`}
                      className="size-5 shrink-0 accent-[var(--color-green-deep,#2f5d59)]"
                    />
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={r.quantity}
                      onChange={(e) => setQuantity(r, Number(e.target.value))}
                      aria-label={`Quantity for ${r.item.name}`}
                      className="min-h-11 w-20 rounded-full border border-[var(--surface-edge)] bg-transparent px-3 text-sm tabular-nums"
                    />
                    <span className="flex-1 text-sm">
                      {r.item.name}
                      {r.item.unit && <span className="text-[var(--text-muted)]"> · {r.item.unit}</span>}
                    </span>
                    <button onClick={() => removeFromList(r)} aria-label={`Remove ${r.item.name}`} className="btn btn-quiet min-h-11 px-3">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
          </div>
        </section>
      )}

      {/* The catalogue for the open tab. */}
      <section className="mt-6">
        <p className="text-[0.72rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
          {CATEGORY_LABEL[category]} · {matches.length}
          {query && ` of ${inCategory.length}`}
        </p>
        <ul className="mt-2">
          {matches.map((item, i) => (
            <li key={item.id} className="border-b border-[var(--surface-edge)] py-2.5 last:border-0">
              {editing === item.id ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    value={editDraft.name}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    className="min-h-11 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
                  />
                  <input
                    value={editDraft.unit}
                    onChange={(e) => setEditDraft({ ...editDraft, unit: e.target.value })}
                    placeholder="Unit"
                    className="min-h-11 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
                  />
                  <input
                    value={editDraft.note}
                    onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })}
                    placeholder="Note"
                    className="min-h-11 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
                  />
                  <select
                    value={editDraft.supplierId}
                    onChange={(e) => setEditDraft({ ...editDraft, supplierId: e.target.value })}
                    aria-label="Supplier"
                    className="min-h-11 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 text-sm"
                  >
                    <option value="">No supplier yet</option>
                    {suppliers.map((sup) => (
                      <option key={sup.id} value={sup.id}>{sup.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-2 sm:col-span-3">
                    <button onClick={() => saveEdit(item)} className="btn btn-primary min-h-11 px-4">Save</button>
                    <button onClick={() => setEditing(null)} className="btn btn-quiet min-h-11 px-4">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {item.name}
                      {item.unit && <span className="text-[var(--text-muted)]"> · {item.unit}</span>}
                      {!item.verified && (
                        <span
                          title="Seeded from a standard recipe, not from Ta-nnin's own list. Edit it to confirm."
                          className="ml-2 rounded-full border border-amber-400 px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.1em] text-amber-700"
                        >
                          check
                        </span>
                      )}
                      {qtyFor(item.id) > 0 && (
                        <span className="ml-2 text-[0.7rem] text-[var(--text-muted)]">on list: {qtyFor(item.id)}</span>
                      )}
                    </p>
                    {(item.note || item.supplier_id) && (
                      <p className="text-[0.75rem] text-[var(--text-muted)]">
                        {supplierName(item.supplier_id) && (
                          <span className="text-[var(--text)]">{supplierName(item.supplier_id)}</span>
                        )}
                        {supplierName(item.supplier_id) && item.note ? ' · ' : ''}
                        {item.note}
                      </p>
                    )}
                  </div>
                  <AddControl item={item} onAdd={addToList} />
                  {/* Reordering only makes sense against the whole list, so it
                      is hidden while a search is narrowing it. */}
                  {!query && (
                    <span className="flex">
                      <button onClick={() => move(item, -1)} disabled={i === 0} aria-label={`Move ${item.name} up`} className="btn btn-quiet min-h-11 px-2">↑</button>
                      <button onClick={() => move(item, 1)} disabled={i === matches.length - 1} aria-label={`Move ${item.name} down`} className="btn btn-quiet min-h-11 px-2">↓</button>
                    </span>
                  )}
                  <button
                    onClick={() => { setEditing(item.id); setEditDraft({ name: item.name, unit: item.unit ?? '', note: item.note ?? '', supplierId: item.supplier_id ?? '' }); }}
                    className="btn btn-quiet min-h-11 px-3 text-[0.7rem]"
                  >
                    Edit
                  </button>
                  <button onClick={() => archive(item)} aria-label={`Remove ${item.name}`} className="btn btn-quiet min-h-11 px-3">×</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {matches.length === 0 && (
          <p className="py-6 text-sm text-[var(--text-muted)]">Nothing matches that.</p>
        )}
      </section>

      {/* Screen-hidden, print-only. Everything else is hidden by the print
          rules in globals.css, so Print gives the basket and nothing else. */}
      <div className="order-print" aria-hidden="true">
        <h2>
          {CATEGORY_LABEL[category]} order
          {finalised ? ` - ${WHEN.format(new Date(finalised.created_at))}` : ''}
        </h2>
        {(finalised?.lines ?? []).map((g, gi) => (
          <div key={gi}>
            <h3>{g.label}</h3>
            <table>
              <tbody>
                {g.rows.map((r, ri) => (
                  <tr key={ri}>
                    <td className="qty">{r.quantity}</td>
                    <td>{r.unit ?? ''}</td>
                    <td>
                      {r.name}
                      {r.note ? ` (${r.note})` : ''}
                    </td>
                    <td className="tick" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Quantity and Add, kept in their own component so typing a number does not
 * re-render the whole catalogue on every keystroke.
 */
function AddControl({ item, onAdd }: { item: Item; onAdd: (item: Item, qty: number) => void }) {
  const [qty, setQty] = useState('1');
  const ref = useRef<HTMLInputElement>(null);

  return (
    <span className="flex items-center gap-1">
      <input
        ref={ref}
        type="number"
        min="0"
        step="any"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        aria-label={`Quantity of ${item.name}`}
        className="min-h-11 w-16 rounded-full border border-[var(--surface-edge)] bg-transparent px-3 text-sm tabular-nums"
      />
      <button
        onClick={() => {
          const n = Number(qty);
          if (n > 0) {
            onAdd(item, n);
            setQty('1');
          }
        }}
        className="btn btn-primary min-h-11 px-3 text-[0.7rem]"
      >
        Add
      </button>
    </span>
  );
}
