import { useTranslations } from 'next-intl';
import { AWARDS, AWARDS_SOURCE, GAULT_MILLAU } from '@tannin/core';
import { Link } from '@/i18n/navigation';
import { HipMark } from './HipMark';

/**
 * The proof, on the home page.
 *
 * Four awards in three years for the wine list is the single strongest thing
 * this place can say about itself, and until now it was buried on the About
 * page. It belongs directly under the wine pitch, where somebody has just read
 * a claim and is deciding whether to believe it.
 *
 * The Gault&Millau side is a label, not a score. HIP entries are recognised
 * without a mark out of twenty, so the layout leads with the word and only
 * shows a number if `GAULT_MILLAU.score` is ever set. Printing "- / 20" for a
 * guide that does not score this category would be inventing a bad result out
 * of a good one.
 */
export function Accolades() {
  const t = useTranslations('accolades');
  const { score, outOf, label, name, quote, url } = GAULT_MILLAU;

  return (
    <section className="border-y border-[var(--surface-edge)]">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:py-24 md:grid-cols-[0.9fr_1.1fr] md:gap-16">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--accent)]">
            {t('guideEyebrow')}
          </p>

          {score !== undefined ? (
            <p className="mt-5 font-[family-name:var(--font-voces)] text-5xl leading-none">
              {score}
              <span className="text-2xl text-[var(--text-muted)]">/{outOf}</span>
            </p>
          ) : (
            // HIP is a mark, not a number. Setting it in our own typeface would
            // be quoting an award in the wrong handwriting.
            <HipMark className="mt-6 h-16 w-auto text-[var(--color-ink)]" />
          )}

          <p className="mt-5 text-[0.8rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {name}
            <span className="sr-only"> - {label}</span>
          </p>

          {/* Their line about the room, credited to them. */}
          <blockquote className="mt-6 max-w-xs text-[0.95rem] leading-relaxed text-[var(--text-muted)]">
            “{quote}”
          </blockquote>

          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block border-b border-[var(--surface-edge)] pb-0.5 text-[0.78rem] text-[var(--text-muted)] hover:border-[var(--accent)]"
          >
            {t('readOn', { guide: name })}
          </a>
        </div>

        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--accent)]">
            {t('awardsEyebrow')}
          </p>
          <h2 className="mt-5 font-[family-name:var(--font-voces)] text-3xl leading-tight text-balance">
            {t('awardsHeading', { count: AWARDS.length })}
          </h2>

          <ul className="mt-8 flex flex-col">
            {AWARDS.map((award) => (
              <li
                key={`${award.year}-${award.title}-${award.scope}`}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-[var(--surface-edge)] py-3.5"
              >
                <span className="text-[0.95rem]">{award.title}</span>
                <span className="text-[0.75rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {award.scope} · {award.year}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-5 text-[0.8rem] text-[var(--text-muted)]">
            {t('awardsSource', { source: AWARDS_SOURCE.name })}{' '}
            <Link href="/about" className="border-b border-[var(--surface-edge)] pb-0.5 hover:border-[var(--accent)]">
              {t('more')}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
