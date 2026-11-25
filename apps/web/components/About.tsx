import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { AWARDS } from '@tannin/core';

/**
 * How the place came to exist.
 *
 * Told as prose rather than a timeline, because the interesting part is not the
 * dates - it is that a man who arrived from Thailand and fell into wine through
 * his father-in-law opened a bar six weeks into a pandemic. The awards go at
 * the bottom: they are the proof, not the story.
 */
export function About() {
  const t = useTranslations('about');

  return (
    <>
      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] text-[var(--color-paper)]">
        <Image
          src="/brand/photo-3.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover opacity-40"
        />
        <div className="relative mx-auto max-w-3xl px-5 py-24 sm:py-32">
          <p className="text-[0.68rem] uppercase tracking-[0.3em] text-[var(--color-green-pale)]">
            {t('eyebrow')}
          </p>
          <h1 className="mt-5 font-[family-name:var(--font-voces)] text-4xl leading-tight sm:text-5xl">
            {t('heading')}
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-[var(--color-paper)]/85">
            {t('standfirst')}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-20 sm:py-28">
        <div className="flex flex-col gap-7 text-[1.02rem] leading-[1.75]">
          <p>{t('body1')}</p>
          <p>{t('body2')}</p>
          <p>{t('body3')}</p>
          <blockquote className="border-l-2 border-[var(--accent)] py-1 pl-6 font-[family-name:var(--font-voces)] text-2xl leading-snug">
            {t('pullQuote')}
          </blockquote>
          <p>{t('body4')}</p>
        </div>

        <div className="mt-20">
          <h2 className="text-[0.72rem] uppercase tracking-[0.2em]">{t('awardsHeading')}</h2>
          <ul className="mt-6 flex flex-col">
            {AWARDS.map((award) => (
              <li
                key={`${award.year}-${award.title}-${award.scope}`}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[var(--surface-edge)] py-4"
              >
                <span className="font-[family-name:var(--font-voces)] text-lg">{award.title}</span>
                <span className="text-[0.8rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {award.scope} · {award.year}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[0.85rem] text-[var(--text-muted)]">{t('awardsNote')}</p>
        </div>
      </section>
    </>
  );
}
