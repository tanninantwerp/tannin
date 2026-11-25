/**
 * Brand tokens, sampled pixel-for-pixel from the logo artwork so the web app,
 * the native apps and any future print piece agree on the same values.
 *
 * Source: def-groen-zwart-logo.png - the black is #000105, the green #417e79.
 * The stamp ink is the blue-grey the wooden stamp actually prints in.
 */
export const COLOURS = {
  /** Logo black. Not pure #000 - it carries a faint blue cast. */
  ink: '#000105',
  /** Logo green, the "urban street wine" lettering. The single accent. */
  green: '#417e79',
  greenDeep: '#2f5d59',
  greenPale: '#a8c6c2',
  /** The wooden stamp's ink. */
  stamp: '#434b66',
  /** Menu-card stock. */
  paper: '#f3f0e9',
  paperDim: '#e4dfd4',
  bone: '#faf8f4',
  /** Neutrals biased very slightly green so they read as chosen. */
  slate: '#5c6462',
  slateDim: '#8b918f',
} as const;

export const FONTS = {
  /** Voces - the display face already used on ta-nnin.be. */
  display: 'Voces',
  /** Work Sans - body and UI. */
  body: 'Work Sans',
} as const;

export const VENUE = {
  name: 'Ta-nnin',
  strapline: 'Urban street wine',
  street: 'Volkstraat 50',
  postcode: '2000',
  city: 'Antwerpen',
  country: 'België',
  phone: '+32 470 10 44 83',
  email: 'info@tannin.be',
  instagram: '@tannin_antwerp',
  /**
   * Online booking. Ta-nnin takes reservations through Zenchef, so the site's
   * Reserve button points here. The in-house booking flow we built still lives
   * behind `/book`.
   */
  bookingUrl: 'https://bookings.zenchef.com/results?rid=368396&pid=1001',
} as const;

/**
 * The bottle shop across the road. Same owner, same list, to take home.
 *
 * One site covers both addresses - the shop is not a separate brand, and the
 * plan is a shared inventory behind them, so what runs low at the bar shows as
 * low in the shop.
 */
export const SHOP = {
  name: 'CE-LLAR',
  tagline: 'basement bottles × Ta-nnin',
  street: 'Volkstraat 45',
  postcode: '2000',
  city: 'Antwerpen',
  instagram: '@cellar_antwerp',
  /** Private tastings, birthdays and company drinks go to this inbox, per the shop's Instagram bio. */
  eventsEmail: 'table@tannin.be',
  /** The most a private event in the shop can take, "for now". */
  maxGuests: 25,
  /**
   * Shop hours as the Instagram bio gives them. Weekday numbers as in
   * `SERVICE_WINDOWS` (0 = Sunday). Every other day it is shut.
   */
  hours: [
    { weekday: 4, opens: '15:00', closes: '19:00' },
    { weekday: 5, opens: '15:00', closes: '19:00' },
    { weekday: 6, opens: '14:00', closes: '19:00' },
  ],
} as const;

/** Front of house, as listed on Star Wine List. */
export const TEAM = [
  { name: 'Tawat Hattatammanoon', role: 'Owner, sommelier' },
  { name: 'Kat', role: 'Sommelier' },
  { name: 'Fred', role: 'Sommelier' },
] as const;

/**
 * Star Wine List awards. Worth putting on the page - a short list judged best
 * in the country four years running is the strongest thing the bar can say
 * about itself, and it currently says it nowhere.
 */
export const AWARDS = [
  { year: 2025, title: 'Best Short List of the Year', scope: 'Belgium & Netherlands' },
  { year: 2024, title: 'International Best Short List of the Year', scope: 'International' },
  { year: 2024, title: 'Best Short List of the Year', scope: 'Belgium' },
  { year: 2023, title: 'Best Short List of the Year', scope: 'Belgium' },
] as const;

/** Who gave those out. */
export const AWARDS_SOURCE = {
  name: 'Star Wine List',
  url: 'https://starwinelist.com/wine-place/tannin',
} as const;

/**
 * The guide listing.
 *
 * Gault&Millau Belgium puts Ta-nnin under **HIP**, which is a label rather than
 * a mark out of twenty - HIP entries are recognised without being scored, so
 * there is no number to print and a "- / 20" would be worse than nothing.
 *
 * `score` is here for the day that changes. Set it and the section shows the
 * number instead of the label; leave it undefined and nothing about the layout
 * assumes one exists.
 */
export const GAULT_MILLAU = {
  name: 'Gault&Millau',
  label: 'HIP',
  score: undefined as number | undefined,
  outOf: 20,
  /** Their words, not ours. Attributed wherever it is shown. */
  quote: 'dares to step off the beaten track',
  url: 'https://www.gaultmillau.be/en/hip/ta-nnin-antwerpen',
} as const;
