import { VENUE } from '@tannin/core';
import type { StaticRoute } from '@/i18n/routing';

/**
 * One list, used by both headers - the big one on the home page and the small
 * one everywhere else. Keeping it here means the two can never fall out of step
 * when a page is added.
 *
 * The Reserve button is deliberately last and styled apart in the headers: it
 * is the only link that asks the reader for something rather than showing them
 * something. Where it goes is a separate choice - see `BookTarget` below.
 */
export const NAV_LINKS: ReadonlyArray<{ href: StaticRoute; key: string }> = [
  { href: '/wine', key: 'wine' },
  { href: '/drinks', key: 'glass' },
  { href: '/menu', key: 'food' },
  { href: '/events', key: 'events' },
  { href: '/cellar', key: 'cellar' },
  { href: '/about', key: 'about' },
  { href: '/visit', key: 'visit' },
];

/**
 * Gift vouchers sit between Visit and Reserve, filled in the house neon yellow
 * so they read as a second thing to act on without competing with Reserve's
 * turquoise.
 */
export const GIFT_LINK: { href: StaticRoute; key: string } = { href: '/gift', key: 'gift' };

/**
 * Where the Reserve button goes. There are two, because the same codebase
 * serves both:
 *
 * - `ZENCHEF_BOOK` - the real Ta-nnin site. The bar books through Zenchef, so
 *   the button sends guests out to their widget.
 * - `IN_HOUSE_BOOK` - the reservation system we built (`/book`, and the
 *   email-linked manage page), kept for venues that book in-house.
 *
 * Both carry the same `key` so the header label ("Book a table") never differs.
 */
export type BookTarget = { href: string; external: boolean; key: string };

export const ZENCHEF_BOOK: BookTarget = {
  href: VENUE.bookingUrl,
  external: true,
  key: 'book',
};

export const IN_HOUSE_BOOK: BookTarget = {
  href: '/book',
  external: false,
  key: 'book',
};
