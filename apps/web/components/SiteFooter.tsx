import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { SHOP, VENUE } from '@tannin/core';
import { Link } from '@/i18n/navigation';
import { HomeLink } from './home-link';
import { LanguageSwitcher } from './LanguageSwitcher';
import { FooterPages } from './FooterPages';

/** Fixed bottom line credit. */
function ForgedBy() {
  return (
    <a
      href="https://18forge.com"
      aria-label="Forged by 18 Forge"
      className="inline-flex items-center gap-[0.35em] whitespace-nowrap no-underline transition-colors duration-200 hover:text-[var(--color-18forge)] focus-visible:text-[var(--color-18forge)]"
    >
      Forged by
      <svg viewBox="0 0 135.15 100" fill="currentColor" aria-hidden="true" focusable="false" style={{ height: '1em', width: 'auto' }}>
        <path fillRule="evenodd" d="M56.08 0.4A0.3 0.3 0 0 0 55.8 0L42.51 0A10.48 10.48 0 0 0 32.63 6.99L0.02 99.55A0.34 0.34 0 0 0 0.34 100L13.81 100A10.8 10.8 0 0 0 24.01 92.74ZM118.34 50.49A2.63 2.63 0 0 1 118.64 47.64L130.62 32.92A20.18 20.18 0 0 0 114.97 0L80.55 0A24.06 24.06 0 0 0 58.73 34.2L64.38 46.34A3.28 3.28 0 0 1 63.75 50.02L46.31 67.89A18.91 18.91 0 0 0 59.85 100L103.98 100A24.27 24.27 0 0 0 125.59 64.67ZM64.37 79.85A0.74 0.74 0 0 1 63.83 78.61L85.79 55.45A8.97 8.97 0 0 0 87.22 45.09L77.42 26.53A4.42 4.42 0 0 1 81.33 20.05L112.63 20.05A1.18 1.18 0 0 1 113.54 21.99L96.52 42.44A8.62 8.62 0 0 0 95.58 52.09L107.3 73.51A4.29 4.29 0 0 1 103.54 79.85Z" />
      </svg>
    </a>
  );
}

export function SiteFooter() {
  const t = useTranslations('footer');

  return (
    <footer className="bg-[var(--color-ink)] px-5 py-16 text-[var(--color-paper)]">
      {/*
        The middle column is sized to its content and the outer two share what
        is left equally, so the credit sits on the true centre of the page, not
        midway between two blocks of different widths. Bottom aligned, so it
        shares a line with EN / NL and the postcode.
      */}
      <div className="mx-auto grid max-w-5xl grid-cols-1 items-end gap-10 sm:grid-cols-[1fr_auto_1fr] sm:gap-8">
        {/*
          Only as wide as EN / NL / FR, with the logo centred on it, so the two
          share one vertical axis. The column itself still sits on the left.
        */}
        <div className="order-1 flex w-fit flex-col items-center gap-6 justify-self-start">
          {/*
            The same mark as the header, cropped to its ink. The full artwork
            carries a transparent margin, which would put the visible logo off
            centre. 82px wide is the size the ink always rendered at.
          */}
          <HomeLink className="shrink-0">
            <Image
              src="/brand/logo-dark-trim.png"
              alt={VENUE.name}
              width={724}
              height={783}
              className="w-[82px]"
            />
          </HomeLink>
          <LanguageSwitcher tone="dark" />
        </div>

        <div className="order-3 flex flex-col items-start gap-3 text-[0.75rem] text-[var(--color-paper)]/60 sm:order-2 sm:flex-row sm:items-baseline sm:gap-5">
          <p className="whitespace-nowrap">
            &copy; {new Date().getFullYear()} {VENUE.name}. All rights reserved.
          </p>
          <ForgedBy />
        </div>

        <div className="order-2 flex flex-col gap-2 text-[0.75rem] text-[var(--color-paper)]/60 sm:order-3 sm:text-right">
          <a
            href={`https://instagram.com/${VENUE.instagram.replace('@', '')}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--color-green-pale)]"
          >
            {t('bar', { handle: VENUE.instagram })}
          </a>
          <a
            href={`https://instagram.com/${SHOP.instagram.replace('@', '')}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--color-green-pale)]"
          >
            {t('shop', { handle: SHOP.instagram })}
          </a>
          <Link href="/gift" className="hover:text-[var(--color-green-pale)]">
            {t('gift')}
          </Link>
          <FooterPages />
          <p className="mt-3">
            {VENUE.name} · {VENUE.street}
            <br />
            {SHOP.name} · {SHOP.street}
            <br />
            {VENUE.postcode} {VENUE.city}
          </p>
        </div>
      </div>
    </footer>
  );
}
