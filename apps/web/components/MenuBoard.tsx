'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AFTERHOURS_STRAPLINE,
  LAST_CALL_KITCHEN,
  formatPrice,
  serviceAt,
  type MenuSection,
  type MenuService,
} from '@tannin/core';

/**
 * Dish names are proper nouns and stay in whichever language the card prints
 * them - "Tagliata carima" does not become anything in Dutch. The sub-line is
 * the part that is really English prose, so that comes from the catalogue,
 * keyed on the item's stable id.
 */
function Item({ id, name, price, withCrackers }: MenuSection['items'][number]) {
  const t = useTranslations('menu');
  const note = t.has(`notes.${id}`) ? t(`notes.${id}`) : null;

  return (
    <li className="py-2.5">
      <div className="flex items-baseline">
        <span className="font-semibold tracking-wide uppercase text-[0.82rem] leading-snug">
          {name}
          {withCrackers && <span aria-hidden="true"> *</span>}
        </span>
        <span className="rule-dotted" aria-hidden="true" />
        <span className="font-semibold text-[0.82rem] tabular-nums shrink-0">{formatPrice(price)}</span>
      </div>
      {note && <p className="mt-0.5 italic text-[0.78rem] text-[var(--text-muted)]">{note}</p>}
    </li>
  );
}

function Section({ section }: { section: MenuSection }) {
  const t = useTranslations('menu');

  return (
    <section className="break-inside-avoid mb-9">
      <h3 className="menu-heading text-[0.72rem] mb-3">{t(`sections.${section.id}`)}</h3>
      <ul>
        {section.items.map((item) => (
          <Item key={item.id} {...item} />
        ))}
      </ul>
    </section>
  );
}

export function MenuBoard({ sections: allSections }: { sections: readonly MenuSection[] }) {
  const t = useTranslations('menu');

  // Opens on whichever card the kitchen is actually serving right now.
  const [service, setService] = useState<MenuService>(() => serviceAt());

  /*
   * Once somebody has picked a tab themselves, the clock stops choosing for
   * them - flipping the card under a person mid-read at 21:30 would be more
   * surprising than useful. Until then, a page left open across last call
   * still switches to the afterhours card on its own: this is the same
   * "kitchen open or not" claim as the printed last-call time, and it should
   * not go stale just because nobody reloaded the tab.
   */
  const chosenManually = useRef(false);

  useEffect(() => {
    const recheck = () => {
      if (!chosenManually.current) setService(serviceAt());
    };
    const id = window.setInterval(recheck, 60_000);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, []);

  const sections = useMemo(() => allSections.filter((s) => s.service === service), [allSections, service]);
  const isAfterhours = service === 'afterhours';

  return (
    <section id="menu" className="px-5 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 text-center">
          <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--text-muted)]">
            {t('eyebrow')}
          </p>
          <h2 className="mt-2 font-[family-name:var(--font-voces)] text-[length:var(--text-section)] leading-tight text-balance">
            {t('heading')}
          </h2>
        </header>

        {/* Two cards exist in the room; the site shows whichever is being served. */}
        <div
          role="tablist"
          aria-label={t('tabsLabel')}
          className="mx-auto mb-9 flex w-fit gap-1 rounded-full border border-[var(--surface-edge)] p-1"
        >
          {(
            [
              ['kitchen', t('tabKitchen')],
              ['afterhours', t('tabAfterhours', { time: LAST_CALL_KITCHEN })],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={service === value}
              onClick={() => {
                chosenManually.current = true;
                setService(value);
              }}
              className={`rounded-full px-5 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] transition-colors ${
                service === value
                  ? 'bg-[var(--color-green-deep)] text-[var(--color-bone)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="card-stock rounded-sm px-6 py-10 shadow-sm sm:px-12 sm:py-14">
          {isAfterhours && (
            <header className="mb-10 text-center">
              <h3 className="font-[family-name:var(--font-voces)] text-2xl">
                {t('afterhoursHeading')}
              </h3>
              {/* Printed on the card in English; it stays that way in both locales. */}
              <p className="mt-1 text-[0.8rem] italic text-[var(--text-muted)]">
                {AFTERHOURS_STRAPLINE}
              </p>
            </header>
          )}

          {/* One column for the short afterhours card, two for the full kitchen card. */}
          <div className={isAfterhours ? 'mx-auto max-w-md' : 'sm:columns-2 sm:gap-14'}>
            {sections.map((section) => (
              <Section key={section.id} section={section} />
            ))}
          </div>

          <footer className="mt-4 border-t border-[var(--surface-edge)] pt-6 text-[0.75rem] text-[var(--text-muted)]">
            {isAfterhours ? (
              <p>{t('afterhoursFootnote')}</p>
            ) : (
              <p className="font-semibold text-[var(--text)]">
                {t('lastCall', { time: LAST_CALL_KITCHEN })}
              </p>
            )}
            <p className="mt-2">{t('allergens')}</p>
          </footer>
        </div>
      </div>
    </section>
  );
}
