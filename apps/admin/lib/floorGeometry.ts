/**
 * The floor plan's shape logic - shared between the live map (`FloorPlan`)
 * and the per-day view (`DayPlan`), which draws the same room with that
 * night's overrides layered on top. Kept framework-free so neither component
 * has to import the other just to reuse a seat-position formula.
 */

export interface FloorTable {
  id: string;
  name: string;
  seats: number;
  min_seats: number;
  area: string;
  active: boolean;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  is_high: boolean;
  is_shared: boolean;
  vertical: boolean;
  one_row: boolean;
  flip_row: boolean;
  ends: boolean;
  connect_group: string | null;
}

export const VBW = 980;
export const VBH = 1500;
export const GRID = 10;

/*
 * The room's three zones. Not booking data - nothing here changes what the
 * website confirms - so unlike the table plan itself, this can stay a fixed
 * shape for now rather than its own database row.
 */
export const ZONES = [
  { area: 'terrace', label: 'Terrace', x: 40, y: 60, w: 900, h: 560 },
  { area: 'bar', label: 'Bar', x: 120, y: 700, w: 700, h: 332 },
  { area: 'inside', label: 'Inside', x: 40, y: 1100, w: 900, h: 400 },
];

/**
 * Where each chair sits, relative to the table's own top-left corner.
 *
 * A one_row bench puts every chair on a single edge; otherwise seats split
 * across the table's two long sides, which are top/bottom normally and
 * left/right once `vertical` is set (a table turned 90°); `ends` restricts
 * that split to just the two short ends, facing across rather than along.
 */
export function seatsRel(t: Pick<FloorTable, 'w' | 'h' | 'seats' | 'one_row' | 'flip_row' | 'ends' | 'vertical'>): {
  cx: number;
  cy: number;
}[] {
  const w = t.w ?? 74;
  const h = t.h ?? 62;
  const o = 14;
  const out: { cx: number; cy: number }[] = [];

  if (t.one_row) {
    const n = t.seats;
    if (w >= h) {
      const cy = t.flip_row ? -o : h + o;
      for (let i = 0; i < n; i++) out.push({ cx: (w * (i + 1)) / (n + 1), cy });
    } else {
      const cx = t.flip_row ? -o : w + o;
      for (let i = 0; i < n; i++) out.push({ cx, cy: (h * (i + 1)) / (n + 1) });
    }
    return out;
  }

  const ends = t.ends && t.seats >= 2 ? 1 : 0;
  const rem = Math.max(0, t.seats - ends * 2);
  const a = Math.ceil(rem / 2);
  const b = rem - a;

  if (t.vertical) {
    for (let i = 0; i < a; i++) out.push({ cx: -o, cy: (h * (i + 1)) / (a + 1) });
    for (let i = 0; i < b; i++) out.push({ cx: w + o, cy: (h * (i + 1)) / (b + 1) });
    if (ends) {
      out.push({ cx: w / 2, cy: -o });
      out.push({ cx: w / 2, cy: h + o });
    }
  } else {
    for (let i = 0; i < a; i++) out.push({ cx: (w * (i + 1)) / (a + 1), cy: -o });
    for (let i = 0; i < b; i++) out.push({ cx: (w * (i + 1)) / (b + 1), cy: h + o });
    if (ends) {
      out.push({ cx: -o, cy: h / 2 });
      out.push({ cx: w + o, cy: h / 2 });
    }
  }
  return out;
}

/**
 * A fill order for a shared table's auto-allocated seats: anchored on one end
 * seat - the "head" of the table - then alternating down the two long sides
 * from that end, so a party reads as sitting together near one head rather
 * than as two separate symmetric halves or (worse) one whole side emptied
 * before the other is touched. Mirrors seatsRel's row/column split; the far
 * end seat, if there is one, fills dead last - it can't seat two on its own
 * and sits apart from everyone else once the near end is taken.
 */
export function condensedSeatOrder(t: Pick<FloorTable, 'seats' | 'one_row' | 'ends' | 'vertical'>): number[] {
  if (t.one_row) return Array.from({ length: t.seats }, (_, i) => i);

  const ends = t.ends && t.seats >= 2 ? 1 : 0;
  const rem = Math.max(0, t.seats - ends * 2);
  const a = Math.ceil(rem / 2);
  const b = rem - a;

  const order: number[] = [];
  if (ends) order.push(a + b);
  for (let i = 0; i < Math.max(a, b); i++) {
    if (i < a) order.push(i);
    if (i < b) order.push(a + i);
  }
  if (ends) order.push(a + b + 1);
  return order;
}

/** Group members of a `connect_group`, in table order, for the dashed link between them. */
export function connectLinks<T extends { x: number | null; y: number | null; connect_group: string | null }>(
  tables: T[],
): { a: T; b: T }[] {
  const groups = new Map<string, T[]>();
  for (const t of tables) {
    if (!t.connect_group || t.x == null || t.y == null) continue;
    const list = groups.get(t.connect_group) ?? [];
    list.push(t);
    groups.set(t.connect_group, list);
  }
  const links: { a: T; b: T }[] = [];
  for (const members of groups.values()) {
    const sorted = [...members].sort((p, q) => (p.x! - q.x!) || (p.y! - q.y!));
    for (let i = 0; i < sorted.length - 1; i++) links.push({ a: sorted[i], b: sorted[i + 1] });
  }
  return links;
}

export function zoneAt(cx: number, cy: number): string | null {
  let area: string | null = null;
  for (const z of ZONES) {
    if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) area = z.area;
  }
  return area;
}
