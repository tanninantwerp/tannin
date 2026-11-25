import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { VENUE } from '@tannin/core';
import { LanguageSwitcher } from './LanguageSwitcher';
import { BookCta } from './BookCta';
import { GiftCta } from './GiftCta';
import { HomeLink } from './home-link';
import { NavLinks } from './NavLinks';
import { ZENCHEF_BOOK, type BookTarget } from './nav-links';

/**
 * The header every page except the home page wears.
 *
 * The home page opens on the logo at full size instead - that is the one place
 * the mark gets the room it deserves. Everywhere else it shrinks to something
 * you click to get back.
 *
 * `book` decides where Reserve goes; it defaults to Zenchef (the real site) and
 * is overridden to the in-house flow on the pages that showcase it.
 */
export function SiteNav({ book = ZENCHEF_BOOK }: { book?: BookTarget } = {}) {
  const t = useTranslations();

  return (
    <header className="border-b border-[var(--color-ink)]/10 bg-[var(--color-ink)] text-[var(--color-paper)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-5">
        <HomeLink className="shrink-0">
          {/*
              The two-tone mark, the same pair of inks the favicon shows. The paper
              version of logo.png used to be produced with `brightness-0 invert`,
              which crushes every pixel to black and flips it to white - legible, but
              it throws the teal "urban street wine" line away and leaves the mark
              flatter than the sign it is a picture of. See scripts/make-logo-dark.mjs.
            */}

          <Image
            src="/brand/logo-dark.png"
            alt={VENUE.name}
            width={1132}
            height={1090}
            className="h-11 w-auto"
          />
        </HomeLink>

        {/*
          `gap-y-3` rather than `gap-y-2`: the row gap only shows when the nav
          wraps, which is phones, and the frame on the current item reaches
          about 6px above its label. At the old gap it cleared the row above by
          2px and read as though it were touching it.
        */}
        <nav className="flex flex-wrap items-center gap-x-7 gap-y-3 text-[0.72rem] uppercase tracking-[0.2em]">
          <NavLinks />
          <GiftCta className="border border-[var(--color-neon-yellow)] bg-[var(--color-neon-yellow)] px-3.5 py-1.5 text-[var(--color-ink)] transition-opacity hover:opacity-90" />
          <BookCta
            target={book}
            label={t(`nav.${book.key}`)}
            className="border border-[var(--color-green-pale)] bg-[var(--color-green-pale)] px-3.5 py-1.5 text-[var(--color-ink)] transition-opacity hover:opacity-90"
          />
          <LanguageSwitcher tone="dark" />
        </nav>
      </div>
    </header>
  );
}
