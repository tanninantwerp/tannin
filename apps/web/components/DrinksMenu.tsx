'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatDrinkPrice, type DrinkSection } from '@tannin/core';

/**
 * The table menu - what the QR code on the card opens.
 *
 * Built for someone holding a phone in a dim room with one hand: big tap
 * targets, a sticky jump-nav so no one scrolls through gin to reach the reds,
 * and search, because the thing people actually do is look for a grape or a
 * producer they half remember.
 *
 * This is the page that replaces the hosted menu tool, so it has to be at least
 * as quick as the thing it replaces. No images, no hero - it renders instantly.
 *
 * Search still runs against the untranslated names and notes, because that is
 * what is on the bottle and what someone types.
 */
export function DrinksMenu({ sections: barList }: { sections: readonly DrinkSection[] }) {
  const t = useTranslations('drinksPage');
  const drinks = useTranslations('drinks');
  const notes = useTranslations('drinks.notes');
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return barList;
    return barList
      .map((section) => ({
        ...section,
        items: section.items.filter((d) =>
          `${d.name} ${d.note ?? ''}`.toLowerCase().includes(q),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [barList, query]);

  const hits = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="min-h-svh pb-24">
      <header className="sticky top-0 z-20 border-b border-[var(--surface-edge)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            className="w-full rounded-full border border-[var(--surface-edge)] bg-transparent px-4 py-2.5 text-[0.9rem]"
          />
        </div>
      </header>

      {/*
        Outside the sticky header on purpose.

        All fourteen categories wrap to five rows on a phone, and pinned to the
        top that is 268px - a third of the screen - permanently spent on a
        control you use once. The search is the thing you come back to; these
        are a "where do I start" aid for the moment you arrive. So they sit at
        the top of the page and scroll away, which is what lets them all be
        visible at once instead of hidden behind a scrollbar or a dropdown.
      */}
      {!query && (
        <nav className="mx-auto flex max-w-2xl flex-wrap gap-2 px-4 pt-4">
          {barList.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded-full border border-[var(--surface-edge)] px-3.5 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]"
            >
              {drinks(`sections.${section.id}`)}
            </a>
          ))}
        </nav>
      )}

      <div className="mx-auto max-w-2xl px-4">
        {query && (
          <p aria-live="polite" className="py-4 text-[0.78rem] text-[var(--text-muted)]">
            {hits === 0 ? t('empty') : t('found', { count: hits })}
          </p>
        )}

        {/* scroll-mt clears the sticky search bar, which is all that is pinned now. */}
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-20 pt-9">
            <h2 className="menu-heading text-[0.7rem] mb-3">{drinks(`sections.${section.id}`)}</h2>
            <ul>
              {section.items.map((drink, i) => (
                <li
                  key={`${drink.name}-${i}`}
                  className="border-b border-[var(--surface-edge)] py-3 last:border-0"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="flex-1 text-[0.92rem] leading-snug">{drink.name}</span>
                    {drink.soldOut ? (
                      <span className="shrink-0 text-[0.7rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                        {drinks('soldOut')}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[0.92rem] font-semibold tabular-nums">
                        {formatDrinkPrice(drink.price)}
                      </span>
                    )}
                  </div>
                  {drink.note && (
                    <p className="mt-1 text-[0.8rem] italic leading-snug text-[var(--text-muted)]">
                      {notes.has(drink.note) ? notes(drink.note) : drink.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
