'use client';

import { useEffect, useState } from 'react';
import { fetchMenu } from '@tannin/supabase';
import { LAST_CALL_KITCHEN, type MenuSection, type MenuSectionId } from '@tannin/core';
import { getDb } from '@/lib/supabase';
import { Logo, MenuBlock, PrintToolbar, QrBlock } from '@/components/print/kit';

// The printed card's fixed arrangement: two faces, two columns each. The
// footer (last call + allergens) lives on the small-bites face.
const FACES: { footer: boolean; cols: MenuSectionId[][] }[] = [
  { footer: false, cols: [['starters', 'salads'], ['land-sea', 'sides']] },
  { footer: true, cols: [['small-bites', 'classics'], ['cheese-cuts', 'sweet']] },
];
const KNOWN = new Set<string>(FACES.flatMap((f) => f.cols.flat()));

function weight(s: MenuSection): number {
  const items = s.items.filter((i) => !i.soldOut);
  return 1.8 + items.reduce((n, i) => n + 1 + (i.note ? 0.7 : 0), 0);
}

// One A5 face - printed onto one half of the A4, so it can be folded down the
// middle and laminated back-to-back.
function Face({ cols, footer }: { cols: MenuSection[][]; footer: boolean }) {
  return (
    <div
      style={{
        width: '140mm',
        height: '202mm',
        padding: '8mm',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ marginBottom: '5mm' }}>
        <Logo />
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8mm' }}>
        {cols.map((col, c) => (
          <div key={c}>
            {col.map((s) => (
              <MenuBlock key={s.id} section={s} />
            ))}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '6mm',
          marginTop: '5mm',
        }}
      >
        {footer ? (
          <div style={{ maxWidth: '72mm' }}>
            <p className="foot-strong">Last call kitchen {LAST_CALL_KITCHEN}</p>
            <p className="foot-note" style={{ marginTop: '3px' }}>
              If you have questions, you can always ask for our allergen card. Compositions of our
              dishes may change.
            </p>
          </div>
        ) : (
          <span />
        )}
        <QrBlock size={72} />
      </div>
    </div>
  );
}

export default function FoodPrint() {
  const [sections, setSections] = useState<MenuSection[] | null>(null);

  useEffect(() => {
    fetchMenu(getDb())
      .then((all) => setSections(all.filter((s) => s.service === 'kitchen')))
      .catch(() => setSections([]));
  }, []);

  let faces: MenuSection[][][] | null = null;
  if (sections) {
    const byId = new Map(sections.map((s) => [s.id, s]));
    faces = FACES.map((f) =>
      f.cols.map((col) => col.map((id) => byId.get(id)).filter((s): s is MenuSection => !!s)),
    );
    const extras = sections.filter((s) => !KNOWN.has(s.id));
    for (const extra of extras) {
      let lightest = faces[0][0];
      let min = Infinity;
      for (const face of faces)
        for (const col of face) {
          const w = col.reduce((n, s) => n + weight(s), 0);
          if (w < min) {
            min = w;
            lightest = col;
          }
        }
      lightest.push(extra);
    }
  }

  return (
    <>
      <style>{`@page { size: A4 landscape; margin: 0; }`}</style>
      <PrintToolbar title="Food menu - fold & laminate" size="A4 landscape" />
      {faces === null ? (
        <p style={{ color: '#f7f4ec' }} className="no-print">
          Loading the menu…
        </p>
      ) : (
        // One A4 landscape sheet: the two faces centred on each half. Print,
        // fold down the middle, laminate - a double-sided A5 card.
        <div className="sheet" style={{ width: '297mm', height: '210mm', display: 'flex', position: 'relative' }}>
          {/* Screen-only guide showing where to fold; never printed. */}
          <div
            className="no-print"
            style={{ position: 'absolute', top: 0, bottom: 0, left: '148.5mm', borderLeft: '1px dashed var(--rule)' }}
          />
          {faces.map((cols, i) => (
            <div
              key={i}
              style={{
                width: '148.5mm',
                height: '210mm',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Face cols={cols} footer={FACES[i].footer} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
