'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDb } from '@/lib/supabase';
import { GRID, ZONES, connectLinks, seatsRel, zoneAt } from '@/lib/floorGeometry';
import type { FloorTable } from '@/lib/floorGeometry';
import { ConnectLinks, DashedLine, ZoneBackground } from '@/components/FloorMapChrome';

type Table = FloorTable;

/**
 * The real floor plan, drawn from `dining_tables` instead of guessed at.
 *
 * A port of the standalone floor-map editor built earlier - same geometry,
 * same seating rules - now reading and writing the live table rows. Drag a
 * table to reposition it; the side panel edits everything else the map needs
 * that the list view (`TablePlanEditor`) doesn't touch: shape, orientation,
 * and which tables push together.
 */
export function FloorPlan() {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  // One area at a time, cropped to fill the frame - the whole room at once is
  // too small to drag tables around in.
  const [mapArea, setMapArea] = useState<string>('terrace');
  const zone = ZONES.find((z) => z.area === mapArea) ?? ZONES[0];
  const PAD = 30;
  const vb = { x: zone.x - PAD, y: zone.y - PAD, w: zone.w + PAD * 2, h: zone.h + PAD * 2 };

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await getDb()
      .from('dining_tables')
      .select(
        'id, name, seats, min_seats, area, active, x, y, w, h, is_high, is_shared, vertical, one_row, flip_row, ends, connect_group',
      )
      .order('position');
    if (err) setError(err.message);
    else setTables((data ?? []) as Table[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const placed = useMemo(
    () => tables.filter((t) => t.x != null && t.y != null && t.area === mapArea),
    [tables, mapArea],
  );
  const unplaced = useMemo(() => tables.filter((t) => t.x == null || t.y == null), [tables]);
  const links = useMemo(() => connectLinks(placed), [placed]);
  const selectedTable = tables.find((t) => t.id === selected) ?? null;

  function posFor(t: Table): { x: number; y: number } {
    if (dragPos && dragPos.id === t.id) return { x: dragPos.x, y: dragPos.y };
    return { x: t.x ?? 0, y: t.y ?? 0 };
  }

  function toSvg(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: vb.x + ((clientX - rect.left) * vb.w) / rect.width,
      y: vb.y + ((clientY - rect.top) * vb.h) / rect.height,
    };
  }

  async function patch(id: string, change: Partial<Table>) {
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...change } : t)));
    const { error: err } = await getDb().from('dining_tables').update(change).eq('id', id);
    if (err) {
      setError(err.message);
      load();
    }
  }

  function onPointerDown(e: React.PointerEvent, t: Table) {
    if (t.x == null || t.y == null) return;
    setSelected(t.id);
    dragRef.current = { id: t.id, startX: e.clientX, startY: e.clientY, ox: t.x, oy: t.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const p0 = toSvg(drag.startX, drag.startY);
    const p1 = toSvg(e.clientX, e.clientY);
    const t = tables.find((x) => x.id === drag.id);
    const w = t?.w ?? 74;
    const h = t?.h ?? 62;
    const nx = Math.max(zone.x, Math.min(zone.x + zone.w - w, drag.ox + (p1.x - p0.x)));
    const ny = Math.max(zone.y, Math.min(zone.y + zone.h - h, drag.oy + (p1.y - p0.y)));
    setDragPos({ id: drag.id, x: nx, y: ny });
  }

  async function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !dragPos) return;
    const x = Math.round(dragPos.x / GRID) * GRID;
    const y = Math.round(dragPos.y / GRID) * GRID;
    setDragPos(null);
    const t = tables.find((tb) => tb.id === drag.id);
    const w = t?.w ?? 74;
    const h = t?.h ?? 62;
    const area = zoneAt(x + w / 2, y + h / 2);
    await patch(drag.id, { x, y, ...(area ? { area } : {}) });
  }

  if (loading) return <p className="p-8 text-[var(--fs-body)] text-[var(--text-muted)]">One moment…</p>;

  return (
    <div>
      {error && <p className="mt-2 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}

      {unplaced.length > 0 && (
        <div className="card mt-4 p-4 text-sm leading-relaxed">
          <strong>{unplaced.length} table{unplaced.length === 1 ? '' : 's'} not yet on the map:</strong>{' '}
          {unplaced.map((t) => t.name).join(', ')}. Added from the list, not yet dragged into place -
          give them a position from the Tables list first.
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {ZONES.map((z) => (
          <button
            key={z.area}
            onClick={() => {
              setMapArea(z.area);
              setSelected(null);
            }}
            className={`btn ${z.area === mapArea ? 'btn-primary' : 'btn-quiet'}`}
          >
            {z.label}
          </button>
        ))}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[0.78rem] text-[var(--text-muted)]">
        <DashedLine /> pushed together - drag any table on the map to reposition it
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div
          className="overflow-x-auto rounded-lg border p-1"
          style={{ background: 'var(--surface)', borderColor: 'var(--surface-edge)' }}
        >
          <svg
            ref={svgRef}
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            className="block h-auto w-full min-w-[320px]"
            style={{ userSelect: 'none' }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerDown={(e) => {
              if (e.target === svgRef.current) setSelected(null);
            }}
          >
            <ZoneBackground zone={zone} />
            <ConnectLinks links={links} posFor={posFor} />

            {placed.map((t) => {
              const { x, y } = posFor(t);
              const w = t.w ?? 74;
              const h = t.h ?? 62;
              const isSelected = selected === t.id;
              return (
                <g
                  key={t.id}
                  transform={`translate(${x} ${y})`}
                  style={{ cursor: 'grab', opacity: t.active ? 1 : 0.35 }}
                  onPointerDown={(e) => onPointerDown(e, t)}
                >
                  {seatsRel(t).map((s, i) => (
                    <circle
                      key={i}
                      cx={s.cx}
                      cy={s.cy}
                      r={6}
                      fill={t.is_high ? 'var(--accent)' : 'var(--surface)'}
                      stroke="var(--accent)"
                      strokeWidth={t.is_high ? 0 : 1.4}
                    />
                  ))}
                  <rect
                    width={w}
                    height={h}
                    rx={9}
                    fill={t.is_high ? 'color-mix(in oklab, var(--accent) 17%, var(--surface-raised))' : 'var(--surface-raised)'}
                    stroke={isSelected ? 'var(--accent)' : 'var(--surface-edge)'}
                    strokeWidth={isSelected ? 3 : 1.6}
                  />
                  <text
                    x={w / 2}
                    y={h / 2 + 4}
                    textAnchor="middle"
                    fontSize={w >= 100 ? 12 : 11}
                    fontWeight={600}
                    fill="var(--text)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {w >= 100 ? t.name.replace(/^.*-\s*/, '') : t.seats}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="card p-4">
          {!selectedTable ? (
            <p className="text-sm text-[var(--text-muted)]">
              Select a table to edit its shape and seating. Drag on the map to reposition.
            </p>
          ) : (
            <TableGeometryPanel key={selectedTable.id} table={selectedTable} onChange={patch} />
          )}
        </div>
      </div>
    </div>
  );
}

function TableGeometryPanel({
  table,
  onChange,
}: {
  table: Table;
  onChange: (id: string, change: Partial<Table>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{table.name}</p>
      <p className="text-[var(--fs-label)] text-[var(--text-muted)]">
        {table.seats} seats · {table.area} · position {Math.round(table.x ?? 0)}, {Math.round(table.y ?? 0)}
      </p>

      <div className="flex gap-2">
        <label className="flex-1 text-[var(--fs-label)] text-[var(--text-muted)]">
          Width
          <input
            inputMode="numeric"
            value={String(table.w ?? '')}
            onChange={(e) => {
              const w = Number(e.target.value);
              if (Number.isFinite(w) && w > 0) onChange(table.id, { w });
            }}
            className="field mt-1"
          />
        </label>
        <label className="flex-1 text-[var(--fs-label)] text-[var(--text-muted)]">
          Height
          <input
            inputMode="numeric"
            value={String(table.h ?? '')}
            onChange={(e) => {
              const h = Number(e.target.value);
              if (Number.isFinite(h) && h > 0) onChange(table.id, { h });
            }}
            className="field mt-1"
          />
        </label>
      </div>

      <button
        onClick={() => onChange(table.id, { w: table.h, h: table.w, vertical: !table.vertical })}
        className="btn btn-quiet"
      >
        Rotate 90°
      </button>

      {[
        ['High table (bar-height)', 'is_high'],
        ['Shared seating', 'is_shared'],
        ['One row (bench / counter)', 'one_row'],
        ['Flip row to the other edge', 'flip_row'],
        ['Seats at the ends', 'ends'],
      ].map(([label, key]) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(table[key as keyof Table])}
            onChange={(e) => onChange(table.id, { [key]: e.target.checked } as Partial<Table>)}
          />
          {label}
        </label>
      ))}

      <label className="text-[var(--fs-label)] text-[var(--text-muted)]">
        Connect group
        <input
          value={table.connect_group ?? ''}
          onChange={(e) => onChange(table.id, { connect_group: e.target.value.trim() || null })}
          placeholder="e.g. street"
          className="field mt-1"
        />
      </label>
    </div>
  );
}
