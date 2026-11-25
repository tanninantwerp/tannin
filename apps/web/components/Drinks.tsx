import { useTranslations } from 'next-intl';
import {
  BAR_SECTIONS,
  GLASS_SECTIONS,
  formatDrinkPrice,
  type DrinkSection,
} from '@tannin/core';

/**
 * Producers, cuvées, grapes and regions are proper nouns and are never
 * translated. The sub-note is a mixed bag - "Manchuela, Spain · Macabeu" is a
 * place and a grape, "Vodka, raspberry, violet, lime" is a recipe - so the
 * catalogue carries an override keyed on the English note and anything without
 * one falls through unchanged.
 */
function Section({ section, dense = false }: { section: DrinkSection; dense?: boolean }) {
  const t = useTranslations('drinks');
  const notes = useTranslations('drinks.notes');

  return (
    <section className="mb-9 break-inside-avoid">
      <h3 className="menu-heading text-[0.68rem] mb-2.5">{t(`sections.${section.id}`)}</h3>
      <ul>
        {section.items.map((drink, i) => (
          <li key={`${drink.name}-${i}`} className={dense ? 'py-1.5' : 'py-2.5'}>
            <div className="flex items-baseline">
              <span className="text-[0.84rem] leading-snug">{drink.name}</span>
              <span className="rule-dotted" aria-hidden="true" />
              {drink.soldOut ? (
                <span className="shrink-0 text-[0.72rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  {t('soldOut')}
                </span>
              ) : (
                <span className="shrink-0 text-[0.84rem] font-semibold tabular-nums">
                  {formatDrinkPrice(drink.price)}
                </span>
              )}
            </div>
            {drink.note && (
              <p className="mt-0.5 text-[0.76rem] italic text-[var(--text-muted)]">
                {notes.has(drink.note) ? notes(drink.note) : drink.note}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * By the glass, and the rest of the bar.
 *
 * A different selection from the bottle list - most of these are pours you
 * cannot get as a bottle, which is the point of coming in rather than buying
 * across the road.
 */
export function Drinks() {
  const t = useTranslations('drinks');

  // Derived, so the sentence cannot drift from the list underneath it.
  const glassCount = GLASS_SECTIONS.reduce((n, s) => n + s.items.length, 0);

  return (
    <section id="drinks" className="px-5 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10">
          <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--text-muted)]">
            {t('eyebrow')}
          </p>
          <h2 className="mt-2 font-[family-name:var(--font-voces)] text-[length:var(--text-section)] leading-tight text-balance">
            {t('heading')}
          </h2>
          <p className="mt-4 max-w-prose text-[var(--text-muted)]">
            {t('body', { count: glassCount })}
          </p>
        </header>

        <div className="card-stock rounded-sm px-6 py-10 shadow-sm sm:px-12 sm:py-14">
          <div className="sm:columns-2 sm:gap-14">
            {GLASS_SECTIONS.map((section) => (
              <Section key={section.id} section={section} />
            ))}
          </div>

          <div className="mt-6 border-t border-[var(--surface-edge)] pt-10">
            <div className="sm:columns-2 sm:gap-14">
              {BAR_SECTIONS.map((section) => (
                <Section key={section.id} section={section} dense />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
