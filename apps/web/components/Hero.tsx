import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { VENUE } from '@tannin/core';
import { LanguageSwitcher } from './LanguageSwitcher';
import { BookCta } from './BookCta';
import { GiftCta } from './GiftCta';
import { NavLinks } from './NavLinks';
import { ZENCHEF_BOOK, type BookTarget } from './nav-links';

/** Which tube the sign is lit with. Yellow is the house one. */
export type NeonTone = 'red' | 'yellow' | 'turquoise';

/**
 * Whole class strings, never built by interpolation.
 *
 * Tailwind finds classes by scanning source text, so a class assembled at
 * runtime is a class that never reaches the stylesheet. That is not theoretical
 * here: interpolating the tone onto the end of this className is exactly what
 * dropped `w-[min(66vw,22rem)]` from the bundle and collapsed the sign to
 * nothing on phones. These particular classes are plain CSS from globals rather
 * than utilities, but they are kept whole anyway - nothing in a className should
 * depend on what a scanner makes of a template literal.
 */
const NEON_TONE_CLASS: Record<NeonTone, string> = {
  red: '',
  yellow: 'neon-logo--yellow',
  turquoise: 'neon-logo--turquoise',
};

/**
 * The room, then the mark.
 *
 * The logo is the most characteristic thing the brand owns - stacked, cropped,
 * green on black - so it opens the page at full size rather than shrunk into a
 * navbar corner.
 *
 * `book` decides where Reserve goes; it defaults to Zenchef (the real site) and
 * can be pointed at the in-house flow instead.
 *
 * `neon` picks the colour of the sign. Yellow is the house one (it replaced the
 * original red); red and turquoise are kept as colourways on `/home2` and `/home3`.
 */
export function Hero({
  book = ZENCHEF_BOOK,
  neon = 'yellow',
}: { book?: BookTarget; neon?: NeonTone } = {}) {
  const t = useTranslations();


  return (
    <header className="relative isolate min-h-[92svh] overflow-hidden bg-[var(--color-ink)] text-[var(--color-paper)]">
      <Image
        src="/brand/photo-6.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover opacity-75"
      />
      {/*
        Darkened only at the top and bottom, where type sits. The bottle wall is
        painted the same green as the logo, so flattening the middle of the frame
        would throw away the one thing the room and the mark already share.
      */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-[var(--color-ink)]/90 via-[var(--color-ink)]/35 to-[var(--color-ink)]/95"
      />

      <div className="relative mx-auto flex min-h-[92svh] max-w-6xl flex-col justify-between px-5 py-10">
        {/*
          Top band is kept for the brand and the language toggle only: the neon
          (lifted into the top-left over the dark ceiling, in globals) owns the
          corner, so the address moves down to the practical band by the nav.
        */}
        <div className="flex items-start justify-end gap-6">
          <LanguageSwitcher tone="dark" />
        </div>

        <div className="flex flex-col items-start gap-8 py-12 sm:flex-row sm:items-end sm:justify-end">
          {/*
            The mark, lit as neon. The logo silhouette masks a hot tube
            colour; the glow, bloom, and flicker live in `.neon-logo` (globals),
            and a non-red `neon` adds a modifier that swaps the hue and nothing
            else.
            role="img" + aria-label keeps the name for assistive tech and SEO.

            On phones it sits in the normal stacked flow (reads well there). On
            desktop it is lifted out of the flow to the top-left, over the dark
            ceiling of the photo and clear of the seated guests (see globals).
          */}
          <span
            role="img"
            aria-label={`${VENUE.name} - ${VENUE.strapline}`}
            className={`neon-logo block ${NEON_TONE_CLASS[neon]}`}
          />

          <p className="max-w-xs text-[0.95rem] leading-relaxed text-[var(--color-paper)]/80">
            {t('hero.intro')}
          </p>
        </div>

        {/* Practical band: where you are, then how to move through and book. */}
        <div className="flex flex-col gap-5">
          <p className="text-[0.68rem] uppercase tracking-[0.3em] text-[var(--color-green-pale)]">
            {VENUE.street} · {VENUE.city}
          </p>
          <nav className="flex flex-wrap items-center gap-x-8 gap-y-3 text-[0.72rem] uppercase tracking-[0.2em]">
            <NavLinks />
            <GiftCta className="border border-[var(--color-neon-yellow)] bg-[var(--color-neon-yellow)] px-4 py-2 text-[var(--color-ink)] transition-opacity hover:opacity-90" />
            <BookCta
              target={book}
              label={t(`nav.${book.key}`)}
              className="border border-[var(--color-green-pale)] bg-[var(--color-green-pale)] px-4 py-2 text-[var(--color-ink)] transition-opacity hover:opacity-90"
            />
          </nav>
        </div>
      </div>
    </header>
  );
}
