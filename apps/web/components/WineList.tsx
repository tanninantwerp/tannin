'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { resolveWineOrigin, type Wine, type WineColour } from '@tannin/core';

const COLOUR_FILTERS = ['all', 'sparkling', 'white', 'orange', 'rose', 'red', 'sweet'] as const;
// Section headings render in this order - the same buckets the cellar is
// entered under in admin, since the printed list's finer regional headings
// don't exist as data once the list comes from the wines table.
const COLOUR_ORDER: readonly WineColour[] = ['sparkling', 'white', 'orange', 'rose', 'red', 'sweet'];

/** The country filter's value for bottles whose country is not settled. */
const UNFILED = '__unfiled__';

/** A dot in roughly the colour of what ends up in the glass. */
const SWATCH: Record<WineColour, string> = {
  sparkling: '#e6d79a',
  white: '#ecdfa6',
  orange: '#d08b3f',
  rose: '#e0a3a0',
  red: '#7d2438',
  sweet: '#b8862f',
};

function Row({ wine, origin }: { wine: Wine; origin: string }) {
  const t = useTranslations('wineList');
  const soldOut = wine.available === false;

  return (
    <li className={`flex items-baseline gap-4 border-b border-[var(--surface-edge)] py-3.5 last:border-0 ${soldOut ? 'opacity-60' : ''}`}>
      <span
        aria-hidden="true"
        className="mt-1.5 size-2 shrink-0 rounded-full ring-1 ring-black/10"
        style={{ background: SWATCH[wine.colour] }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[0.9rem] leading-snug">
          <span className="font-semibold">{wine.producer}</span>
          {wine.name && wine.name !== wine.producer && (
            <span className="text-[var(--text-muted)]"> - {wine.name}</span>
          )}
        </p>
        <p className="mt-0.5 text-[0.78rem] text-[var(--text-muted)]">
          {wine.vintage ? `${wine.vintage} · ` : 'NV · '}
          {origin}
          {wine.grapes?.length ? ` · ${wine.grapes.join(', ')}` : ''}
        </p>
        {wine.tastingNote && (
          <p className="mt-1 text-[0.78rem] italic leading-snug text-[var(--text-muted)]">{wine.tastingNote}</p>
        )}
      </div>
      {soldOut ? (
        <span className="shrink-0 text-[0.7rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
          {t('soldOut')}
        </span>
      ) : (
        <span className="shrink-0 text-[0.85rem] font-semibold tabular-nums">
          {wine.bottle > 0 ? wine.bottle.toFixed(2).replace('.', ',') : t('onRequest')}
        </span>
      )}
    </li>
  );
}

export function WineList({ wines }: { wines: readonly Wine[] }) {
  const t = useTranslations('wineList');
  const [colour, setColour] = useState<WineColour | 'all'>('all');
  const [country, setCountry] = useState('all');
  const [region, setRegion] = useState('all');
  const [query, setQuery] = useState('');

  /*
   * Country and region, separated.
   *
   * The list was transcribed from a printed card that prints one line of
   * origin, so "Burgundy", "Rioja" and "Auxey-Duresses" all landed in the
   * country column next to "France" and "Spain". The filter therefore offered
   * sixty-nine options, most of which were not countries, and choosing France
   * quietly hid every French wine whose line happened to say Burgundy.
   *
   * `resolveWineOrigin` (in core, and unit-tested there) does the untangling and
   * refuses to guess: a bottle it cannot place keeps `country: null` and is
   * offered under its own heading rather than being filed under something
   * plausible. Two rows in the current cellar are genuinely undecidable -
   * "Slovenia x Italy" and "Macedonia" - and that is exactly where they land.
   */
  const rows = useMemo(
    () => wines.map((wine) => ({ wine, ...resolveWineOrigin(wine) })),
    [wines],
  );

  const countries = useMemo(
    () =>
      [...new Set(rows.map((r) => r.country).filter((c): c is string => c !== null))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [rows],
  );

  const hasUnfiled = useMemo(() => rows.some((r) => r.country === null), [rows]);

  // Regions are offered only once a country is chosen: the cellar holds well
  // over a hundred of them, and an unfiltered list of that length is a worse
  // control than no control at all.
  const regions = useMemo(() => {
    if (country === 'all' || country === UNFILED) return [];
    return [
      ...new Set(
        rows
          .filter((r) => r.country === country && r.region)
          .map((r) => r.region as string),
      ),
    ].sort((a, b) => a.localeCompare(b));
  }, [rows, country]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (colour !== 'all' && r.wine.colour !== colour) return false;
      if (country === UNFILED) {
        if (r.country !== null) return false;
      } else if (country !== 'all' && r.country !== country) {
        return false;
      }
      if (region !== 'all' && r.region !== region) return false;
      if (!q) return true;
      // Producers, cuvées, grapes and places are all things people search by -
      // including the resolved country, so "france" finds the Burgundies.
      return [r.wine.producer, r.wine.name, r.region, r.country, ...(r.wine.grapes ?? [])]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [rows, colour, country, region, query]);

  const grouped = useMemo(() => {
    const map = new Map<WineColour, typeof matches>();
    for (const row of matches) {
      const list = map.get(row.wine.colour);
      if (list) list.push(row);
      else map.set(row.wine.colour, [row]);
    }
    return COLOUR_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [matches]);

  const filtered = colour !== 'all' || country !== 'all' || region !== 'all' || query.trim() !== '';

  function reset() {
    setColour('all');
    setCountry('all');
    setRegion('all');
    setQuery('');
  }

  const selectClass =
    'min-h-11 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 py-2 text-[0.78rem]';

  return (
    <section id="wine-list" className="px-5 py-14 sm:py-28">
      <div className="mx-auto max-w-4xl">
        <header className="mb-9">
          <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--text-muted)]">
            {t('eyebrow')}
          </p>
          <h1 className="mt-2 font-[family-name:var(--font-voces)] text-[length:var(--text-section)] leading-tight text-balance">
            {t('heading', { count: wines.length })}
          </h1>
          <p className="mt-4 max-w-prose text-[var(--text-muted)]">{t('body')}</p>
        </header>

        <div className="mb-8 flex flex-wrap items-center gap-3">
          {/*
            `rounded-3xl`, not `rounded-full`.

            A full radius is half the box's height, which is a tidy pill only
            while the row fits on one line. On a phone these seven filters wrap
            to two rows, the radius grows with the taller box, and the corner
            pills end up sitting outside the curve - the selected one worst of
            all, because it is filled and the overflow is obvious.

            A fixed 24px corner matches the wrapped block on a phone and is
            within 2px of the full radius on one desktop row, so the shape it
            replaces is not visibly different where it used to be correct.
          */}
          <div className="flex flex-wrap gap-1 rounded-3xl border border-[var(--surface-edge)] p-1">
            {COLOUR_FILTERS.map((value) => (
              <button
                key={value}
                onClick={() => setColour(value)}
                aria-pressed={colour === value}
                className={`min-h-11 rounded-full px-4 text-[0.7rem] font-semibold uppercase tracking-[0.12em] transition-colors ${
                  colour === value
                    ? 'bg-[var(--color-green-deep)] text-[var(--color-bone)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {t(`colours.${value}`)}
              </button>
            ))}
          </div>

          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              // The old region no longer belongs to the new country.
              setRegion('all');
            }}
            aria-label={t('countryLabel')}
            className={selectClass}
          >
            <option value="all">{t('allCountries')}</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {hasUnfiled && <option value={UNFILED}>{t('unfiled')}</option>}
          </select>

          {regions.length > 0 && (
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              aria-label={t('regionLabel')}
              className={selectClass}
            >
              <option value="all">{t('allRegions')}</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            className="min-h-11 min-w-52 flex-1 rounded-full border border-[var(--surface-edge)] bg-transparent px-4 py-2 text-[0.78rem]"
          />

          {filtered && (
            <button
              onClick={reset}
              className="min-h-11 rounded-full border border-[var(--surface-edge)] px-4 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              {t('reset')}
            </button>
          )}
        </div>

        <p aria-live="polite" className="mb-6 text-[0.75rem] text-[var(--text-muted)]">
          {t('results', { count: matches.length })}
        </p>

        {grouped.length === 0 ? (
          <div className="card-stock rounded-sm px-6 py-12 text-center">
            <p className="text-[var(--text-muted)]">{t('empty')}</p>
            {/* Nothing found is a dead end without a way back out of it. */}
            {filtered && (
              <button
                onClick={reset}
                className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--color-green-deep)] px-6 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-bone)]"
              >
                {t('reset')}
              </button>
            )}
          </div>
        ) : (
          <div className="card-stock rounded-sm px-6 py-8 sm:px-10">
            {grouped.map(([groupColour, list]) => (
              <section key={groupColour} className="mb-10 last:mb-0">
                <h2 className="menu-heading text-[0.7rem] mb-2">{t(`colours.${groupColour}`)}</h2>
                <ul>
                  {list.map(({ wine, region: r, country: c }) => (
                    <Row
                      key={wine.id}
                      wine={wine}
                      origin={[r, c].filter(Boolean).join(', ')}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
