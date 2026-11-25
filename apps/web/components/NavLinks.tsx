'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { NAV_LINKS } from './nav-links';

/**
 * The nav list both headers share, with the current section framed.
 *
 * It lives in one component rather than being mapped out in each header because
 * there are two of them - the big one in the hero and the small one on every
 * other page - and a reader who learns what the turquoise frame means in one
 * would have to learn it again if the two ever drifted apart.
 *
 * Client-side only because it needs `usePathname`; both headers are otherwise
 * server components and stay that way.
 *
 * `/events/spring-tasting` marks Events too, so a page deeper in a section
 * still tells you which section you are in. The match is on the path only - the
 * locale prefix is already stripped by next-intl's hook, so the Dutch `/nl/wijn`
 * lands on `/wine` here and marks the same item.
 */
export function NavLinks() {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <>
      {NAV_LINKS.map(({ href, key }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={
              current
                ? 'relative border-b border-transparent pb-1'
                : 'relative border-b border-transparent pb-1 hover:border-[var(--color-green-pale)]'
            }
          >
            {t(`nav.${key}`)}
            {/*
              The frame is drawn by an absolutely positioned box rather than by
              a border on the link itself. A real border would need padding to
              sit clear of the letters, and padding only on the current item
              shifts the whole row every time you change page - while padding on
              all six costs every item the space its frame needs but never uses.
              Taken out of the flow, it costs the layout nothing and the labels
              do not move.

              The insets are not symmetrical, for two reasons. The link carries
              `pb-1` for the hover rule, so the bottom starts 4px lower than the
              top and the offsets have to take that back out. And the 0.2em
              tracking is added after the last letter too, so the text's box
              runs about 2px past the final letter - hence 10px of air on the
              left against 8px on the right, which is what actually looks even.

              No hover underline on the current item: it is already framed, and
              drawing a second line inside the box reads as a mistake.
            */}
            {current && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -left-2.5 -right-2 -top-1.5 -bottom-0.5 border border-[var(--color-green-pale)]"
              />
            )}
          </Link>
        );
      })}
    </>
  );
}
