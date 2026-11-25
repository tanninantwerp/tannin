'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchWines } from '@tannin/supabase';
import type { Wine, WineColour } from '@tannin/core';
import { getDb } from '@/lib/supabase';
import { Logo, PrintToolbar } from '@/components/print/kit';

const COLOUR_ORDER: readonly WineColour[] = ['sparkling', 'white', 'orange', 'rose', 'red', 'sweet'];
const COLOUR_LABEL: Record<WineColour, string> = {
  sparkling: 'Sparkling',
  white: 'White',
  orange: 'Orange',
  rose: 'Rosé',
  red: 'Red',
  sweet: 'Sweet',
};

const MM = 3.7795275591; // CSS px per mm
const PADDING_MM = 14;
const PAGE_BUDGET = (297 - 2 * PADDING_MM) * MM; // usable height per A4 page, in px

function price(n: number): string {
  return n > 0 ? n.toFixed(2).replace('.', ',') : 'On request';
}

function WineRow({ wine }: { wine: Wine }) {
  const origin = [wine.region, wine.country].filter(Boolean).join(', ');
  return (
    <div className="wine-row">
      <div className="wine-main">
        <span className="wine-producer">{wine.producer}</span>
        {wine.name && wine.name !== wine.producer && <span> - {wine.name}</span>}
        <div className="wine-meta">
          {wine.vintage ? `${wine.vintage} · ` : 'NV · '}
          {origin}
          {wine.grapes?.length ? ` · ${wine.grapes.join(', ')}` : ''}
        </div>
      </div>
      <span className="wine-price">{price(wine.bottle)}</span>
    </div>
  );
}

type Page = { colour: WineColour; rows: Wine[] };

export default function WinePrint() {
  const [wines, setWines] = useState<Wine[] | null>(null);
  const [pages, setPages] = useState<Page[] | null>(null);
  const measure = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchWines(getDb())
      .then((all) => setWines(all.filter((w) => w.available !== false)))
      .catch(() => setWines([]));
  }, []);

  const groups = wines
    ? COLOUR_ORDER.map((colour) => ({ colour, rows: wines.filter((w) => w.colour === colour) })).filter(
        (g) => g.rows.length > 0,
      )
    : [];

  // Measure real heights (logo, a section header, every row) then pack rows into
  // fixed A4 pages. Each page repeats the logo and the colour header, so a long
  // section continues cleanly with its own margins on the next page. Measuring
  // waits for the font so row heights match what actually prints.
  useEffect(() => {
    if (!wines) return;
    let cancelled = false;
    const run = () => {
      const el = measure.current;
      if (!el || cancelled) return;
      const logoH = (el.querySelector('[data-m="logo"]') as HTMLElement)?.offsetHeight ?? 60;
      const headerH = (el.querySelector('[data-m="header"]') as HTMLElement)?.offsetHeight ?? 34;
      const rowH = new Map<string, number>();
      el.querySelectorAll('[data-row]').forEach((n) => {
        rowH.set((n as HTMLElement).dataset.row!, (n as HTMLElement).offsetHeight);
      });

      const result: Page[] = [];
      for (const g of groups) {
        let i = 0;
        while (i < g.rows.length) {
          let budget = PAGE_BUDGET - logoH - headerH;
          const slice: Wine[] = [];
          while (i < g.rows.length) {
            // Pad measured heights so a row that renders a hair taller never spills.
            const h = (rowH.get(g.rows[i].id) ?? 40) * 1.1;
            if (slice.length > 0 && budget - h < 0) break;
            slice.push(g.rows[i]);
            budget -= h;
            i++;
          }
          result.push({ colour: g.colour, rows: slice });
        }
      }
      if (!cancelled) setPages(result);
    };
    // Wait for the web font before measuring; fall back if the API is absent.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(run);
    } else {
      run();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wines]);

  return (
    <>
      <style>{`@page { size: A4 portrait; margin: 0; }`}</style>
      <PrintToolbar title="Wine list - by section" size="A4 portrait" />

      {wines === null ? (
        <p style={{ color: '#f7f4ec' }} className="no-print">
          Loading the cellar…
        </p>
      ) : pages === null ? (
        // Hidden measuring pass - same content width as a real page.
        <div
          ref={measure}
          aria-hidden
          style={{ position: 'absolute', visibility: 'hidden', width: `${210 - 2 * PADDING_MM}mm` }}
        >
          <div data-m="logo">
            <Logo />
          </div>
          <h2 className="sec-head" data-m="header">
            {COLOUR_LABEL[groups[0]?.colour ?? 'red']}
          </h2>
          {groups.flatMap((g) =>
            g.rows.map((w) => (
              <div key={w.id} data-row={w.id}>
                <WineRow wine={w} />
              </div>
            )),
          )}
        </div>
      ) : (
        pages.map((p, i) => (
          <div
            key={i}
            className="sheet"
            style={{ width: '210mm', height: '297mm', padding: `${PADDING_MM}mm`, boxSizing: 'border-box' }}
          >
            <div style={{ marginBottom: '9mm' }}>
              <Logo />
            </div>
            <h2 className="sec-head">{COLOUR_LABEL[p.colour]}</h2>
            {p.rows.map((w) => (
              <WineRow key={w.id} wine={w} />
            ))}
          </div>
        ))
      )}
    </>
  );
}
