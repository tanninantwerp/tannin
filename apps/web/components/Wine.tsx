import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { SHOP, VENUE, WINES } from '@tannin/core';

/**
 * The wine section.
 *
 * Deliberately not a list yet - the by-the-glass card changes constantly and
 * a stale list on a website is worse than none. The full cellar goes in when
 * Tawat's real list is loaded; until then this section sells the approach and
 * points at the shop across the road.
 *
 * "Urban street wine" is the strapline off the logo, so it is the same three
 * words in every language.
 */
export function Wine({ cellarCount }: { cellarCount?: number } = {}) {
  const t = useTranslations('wine');

  const facts = [
    [t('glassTerm'), t('glassDetail')],
    [t('cellarTerm'), t('cellarDetail', { count: cellarCount ?? WINES.length })],
    [t('shopTerm'), t('shopDetail', { shop: SHOP.name })],
  ] as const;

  return (
    <section id="wine" className="relative isolate overflow-hidden bg-[var(--color-ink)] text-[var(--color-paper)]">
      <Image src="/brand/photo-5.jpg" alt="" fill sizes="100vw" className="object-cover opacity-45" />
      <div aria-hidden="true" className="absolute inset-0 bg-[var(--color-ink)]/72" />

      <div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-24 sm:py-32 md:grid-cols-[1.15fr_1fr] md:items-center">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--color-green-pale)]">
            {t('eyebrow')}
          </p>
          <h2 className="mt-2 font-[family-name:var(--font-voces)] text-[length:var(--text-section)] leading-tight text-balance">
            {t('heading')}
          </h2>
          <p className="mt-6 max-w-prose leading-relaxed text-[var(--color-paper)]/80">{t('body')}</p>

          <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 text-sm sm:grid-cols-3">
            {facts.map(([term, detail]) => (
              <div key={term}>
                <dt className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-green-pale)]">
                  {term}
                </dt>
                <dd className="mt-1 text-[var(--color-paper)]/85">{detail}</dd>
              </div>
            ))}
          </dl>

        </div>

        {/* The wooden stamp they actually ink the bills with. */}
        <figure className="justify-self-center">
          <Image
            src="/brand/stamp.png"
            alt={t('stampAlt', { venue: VENUE.name })}
            width={893}
            height={695}
            className="w-[min(70vw,22rem)] opacity-90 brightness-0 invert"
          />
          <figcaption className="mt-4 text-center text-[0.72rem] uppercase tracking-[0.18em] text-[var(--color-paper)]/50">
            {t('stampCaption')}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
