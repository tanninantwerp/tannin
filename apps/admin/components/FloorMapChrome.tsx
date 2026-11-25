'use client';

/**
 * The bits of the floor plan that look identical everywhere it's drawn - the
 * zone's background rect and label, and the dashed line joining a
 * `connect_group`'s tables. Split out of FloorPlan/DayPlan/SeatPicker, which
 * each used to redraw these from scratch; a change to how a zone reads now
 * only has one place to make it.
 */
export function ZoneBackground({
  zone,
}: {
  zone: { x: number; y: number; w: number; h: number; label: string };
}) {
  return (
    <g>
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.w}
        height={zone.h}
        rx={14}
        fill="var(--surface-raised)"
        stroke="var(--surface-edge)"
        strokeWidth={1.5}
        opacity={0.6}
      />
      <text x={zone.x + 20} y={zone.y + 30} fontSize={15} fontWeight={600} fill="var(--text-muted)">
        {zone.label.toUpperCase()}
      </text>
    </g>
  );
}

export function ConnectLinks<T extends { w: number | null; h: number | null }>({
  links,
  posFor,
}: {
  links: { a: T; b: T }[];
  posFor: (t: T) => { x: number; y: number };
}) {
  return (
    <>
      {links.map(({ a, b }, i) => {
        const pa = posFor(a);
        const pb = posFor(b);
        const ca = { x: pa.x + (a.w ?? 74) / 2, y: pa.y + (a.h ?? 62) / 2 };
        const cb = { x: pb.x + (b.w ?? 74) / 2, y: pb.y + (b.h ?? 62) / 2 };
        return (
          <path
            key={i}
            d={`M ${ca.x} ${ca.y} L ${cb.x} ${cb.y}`}
            stroke="var(--accent)"
            strokeWidth={1.8}
            strokeDasharray="4 3"
            fill="none"
          />
        );
      })}
    </>
  );
}

/** A consistent chair-colour key, so what red/blue/dashed mean doesn't have to be relearned per screen. */
export function SeatLegend({ items }: { items: { swatch: React.ReactNode; label: string }[] }) {
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.78rem] text-[var(--text-muted)]">
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {item.swatch}
          {item.label}
        </span>
      ))}
    </p>
  );
}

export function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
}

export function RingDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: 'transparent', border: `1.6px solid ${color}` }}
    />
  );
}

export function DashedLine() {
  return (
    <svg width="18" height="10" aria-hidden="true">
      <line x1="1" y1="5" x2="17" y2="5" stroke="var(--accent)" strokeWidth={1.8} strokeDasharray="4 3" />
    </svg>
  );
}
