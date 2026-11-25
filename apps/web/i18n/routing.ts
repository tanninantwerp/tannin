import { defineRouting } from 'next-intl/routing';

/**
 * Three locales, English first.
 *
 * `as-needed` keeps the English site exactly where it has always been - `/` and
 * `/drinks` - and puts Dutch under `/nl` and French under `/fr`. That matters more than it looks: the
 * QR code printed on the table card points at `/drinks`, and a reprint costs
 * money, so that URL is effectively permanent.
 *
 * Detection is off on purpose. With it on, a Flemish phone scanning the card
 * would be redirected to `/nl/drinks`, which is a nice touch right up until the
 * moment someone reports "the QR sends me somewhere else now". The switcher in
 * the header is explicit instead.
 */
export const routing = defineRouting({
  locales: ['en', 'nl', 'fr'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  localeDetection: false,
  localeCookie: false,

  /**
   * The left-hand side is the internal route - the folder under `app/[locale]`
   * and the `href` you pass to `Link`. The right-hand side is what the reader
   * sees. Someone searching "ta-nnin wijnkaart" gets a URL that says wijnkaart.
   *
   * `/drinks` is deliberately the same word in every language. It is the one URL that
   * ends up printed on a table card, and a Dutch alias for it would mean two
   * live addresses for the thing we least want to be ambiguous.
   */
  pathnames: {
    '/': '/',
    // A copy of the home page whose Reserve button opens the in-house booking
    // flow instead of Zenchef - the live showcase of the system for other
    // venues. Same word in both locales; it is never printed anywhere.
    // Two colourways of the home page, red against yellow and turquoise, up for a
    // decision. Same word in both locales; neither is printed or linked.
    '/home2': '/home2',
    '/home3': '/home3',
    '/menu': { en: '/menu', nl: '/kaart', fr: '/carte' },
    '/wine': { en: '/wine', nl: '/wijnkaart', fr: '/carte-des-vins' },
    '/drinks': '/drinks',
    '/book': { en: '/book', nl: '/reserveren', fr: '/reserver' },
    '/about': { en: '/about', nl: '/over-ons', fr: '/a-propos' },
    '/visit': { en: '/visit', nl: '/bezoek', fr: '/nous-trouver' },
    '/events': { en: '/events', nl: '/evenementen', fr: '/evenements' },
    // The bottle shop across the road. Its own name, so the same in both.
    '/cellar': '/cellar',
    // Gift vouchers, and the page Stripe sends the buyer back to.
    '/gift': { en: '/gift', nl: '/cadeaubon' },
    '/gift/thanks': { en: '/gift/thanks', nl: '/cadeaubon/bedankt' },
    // Reached only from a link in a confirmation email.
    '/booking/[token]': { en: '/booking/[token]', nl: '/reservering/[token]', fr: '/reservation/[token]' },
  },
});

export type Locale = (typeof routing.locales)[number];
export type Route = keyof typeof routing.pathnames;

/**
 * Routes with no dynamic segment.
 *
 * `Link` and `getPathname` take a plain string for these, but demand
 * `{ pathname, params }` for anything containing a `[token]` - so the two
 * cannot share a type. Navigation and page metadata only ever deal with static
 * routes; the one dynamic route is reached from an email.
 */
export type StaticRoute = Exclude<Route, `${string}[${string}`>;
