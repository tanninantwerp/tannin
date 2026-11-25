import en from '../messages/en.json';
import nl from '../messages/nl.json';
import fr from '../messages/fr.json';

/**
 * The site's own texts (buttons, headings, page copy), in the three languages,
 * and what the admin needs to change them without a deploy.
 *
 * The JSON files are the starting wording. Admin > Texts stores an edit in the
 * `site_texts` table, keyed by the message's dotted path ("about.heading"),
 * and the website lays those edits over the JSON when it renders. A key with
 * no row simply shows the JSON, so a new text can still be added in code
 * without touching the database. Brought over from the 58diamonds admin.
 */

export const LOCALES = ['en', 'nl', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', nl: 'Nederlands', fr: 'Français' };

/** One text in each language. A language left out falls back to the JSON wording. */
export type L10n = Partial<Record<Locale, string>>;

export type Messages = { [key: string]: string | Messages };

export const DEFAULT_MESSAGES: Record<Locale, Messages> = { en, nl, fr } as Record<Locale, Messages>;

/** `{ about: { heading: 'x' } }` -> `{ 'about.heading': 'x' }`. */
export function flatten(messages: Messages, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(messages)) {
    if (typeof v === 'string') out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

/**
 * The messages for one language with the admin's edits laid over them.
 *
 * Only a key that exists in the English file and holds a string is replaced,
 * so a row left behind by a renamed key, or one that would turn a group into a
 * string, does nothing instead of breaking a page. Empty values are ignored.
 */
export function applyOverrides(messages: Messages, overrides: Record<string, L10n>, locale: Locale): Messages {
  const base = flatten(DEFAULT_MESSAGES.en);
  const out = structuredClone(messages);
  for (const [key, value] of Object.entries(overrides)) {
    const text = value?.[locale]?.trim();
    if (!text || !(key in base)) continue;
    const parts = key.split('.');
    let node: Messages = out;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (typeof next === 'string') break;
      node = next ?? (node[part] = {});
    }
    const last = parts[parts.length - 1]!;
    if (typeof node[last] !== 'object') node[last] = value[locale]!;
  }
  return out;
}

/** Keys the admin does not show: notes to translators and technical values. */
function hidden(key: string): boolean {
  return key.split('.').some((p) => p.startsWith('_')) || key === 'meta.ogLocale' || key.startsWith('language.');
}

/**
 * The sections of Admin > Texts, in the order the site reads, each with a name
 * a person would use. A namespace not listed here still shows, under its own
 * name, before "Not on the site at the moment".
 */
const GROUPS: [ns: string, name: string][] = [
  ['nav', 'Header menu'],
  ['hero', 'Home: top'],
  ['wine', 'Home: wine'],
  ['drinks', 'Drinks and bar list'],
  ['drinksPage', 'Bar list page (QR code)'],
  ['wineList', 'Wine list page'],
  ['menu', 'Food menu'],
  ['accolades', 'Guides and awards'],
  ['events', 'Events'],
  ['cellar', 'CE-LLAR'],
  ['about', 'About'],
  ['visit', 'Visit and opening hours'],
  ['weekdays', 'Days of the week'],
  ['gift', 'Gift vouchers'],
  ['footer', 'Footer'],
  ['notFound', 'Page not found'],
  ['meta', 'Search engines (Google)'],
  ['booking', 'Not on the site at the moment: booking'],
  ['manage', 'Not on the site at the moment: manage booking'],
];

export interface TextDef {
  key: string;
  /** The rest of the key after its section, made readable: "errors.guestName" -> "Errors / guest name". */
  label: string;
  /** Long enough to deserve a text area. */
  multiline: boolean;
  /** The JSON wording. A language missing from its file is empty here. */
  value: L10n;
}

export interface TextSection {
  ns: string;
  name: string;
  texts: TextDef[];
}

/** Every editable text, in sections, in the order of the files. */
export function textSections(): TextSection[] {
  const flat = Object.fromEntries(LOCALES.map((l) => [l, flatten(DEFAULT_MESSAGES[l])])) as Record<Locale, Record<string, string>>;
  const byNs = new Map<string, TextDef[]>();
  for (const key of Object.keys(flat.en)) {
    if (hidden(key)) continue;
    const ns = key.split('.')[0]!;
    const value: L10n = {};
    for (const l of LOCALES) if (flat[l][key] !== undefined) value[l] = flat[l][key];
    const longest = Math.max(...Object.values(value).map((v) => v?.length ?? 0));
    if (!byNs.has(ns)) byNs.set(ns, []);
    byNs.get(ns)!.push({ key, label: labelFor(key), multiline: longest > 80, value });
  }
  const known = GROUPS.map(([ns]) => ns);
  const rank = (ns: string) => {
    const i = known.indexOf(ns);
    const offTheSite = GROUPS.findIndex(([, name]) => name.startsWith('Not on the site'));
    return i < 0 ? offTheSite - 0.5 : i;
  };
  return [...byNs.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([ns, texts]) => ({ ns, name: GROUPS.find(([n]) => n === ns)?.[1] ?? labelFor(ns), texts }));
}

function labelFor(key: string): string {
  const rest = key.includes('.') ? key.split('.').slice(1) : [key];
  return rest
    .map((p) => {
      const words = p.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
      return words.charAt(0).toUpperCase() + words.slice(1);
    })
    .join(' / ');
}

/**
 * The {placeholders} in a text, which the site fills in (a name, a number).
 * An edit has to keep the same ones, or the page shows a raw `{name}` or an error.
 */
export function placeholders(text: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0) names.add(text.slice(start, i).split(',')[0]!.trim());
    }
  }
  return [...names].sort();
}

/** Why an edit cannot be saved as typed, or null when it can. */
export function checkText(original: string, edited: string): string | null {
  let depth = 0;
  for (const c of edited) {
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) return 'The { and } do not match up.';
  const want = placeholders(original);
  const got = placeholders(edited);
  const missing = want.filter((p) => !got.includes(p));
  const extra = got.filter((p) => !want.includes(p));
  if (missing.length) return `Keep ${missing.map((p) => `{${p}}`).join(', ')}: the site fills it in.`;
  if (extra.length) return `${extra.map((p) => `{${p}}`).join(', ')} is not something the site can fill in here.`;
  const tags = (s: string) => (s.match(/<\/?[a-zA-Z]+>/g) ?? []).sort().join();
  if (tags(original) !== tags(edited)) return 'Keep the <tags> as they are: they mark links or bold words.';
  return null;
}

/**
 * Web addresses a page made in Admin > Pages may not take, because the site
 * already answers there: its own pages in every language, the language
 * prefixes, the API, and the old WordPress addresses that redirect.
 * apps/web/lib/reserved.test.ts fails if the routing table gains a page
 * that is missing here.
 */
export const RESERVED_SLUGS = [
  'en', 'nl', 'fr', 'api', 'demo', 'admin',
  'home2', 'home3',
  'menu', 'kaart', 'carte',
  'wine', 'wijnkaart', 'carte-des-vins',
  'drinks',
  'book', 'reserveren', 'reserver',
  'about', 'over-ons', 'a-propos',
  'visit', 'bezoek', 'nous-trouver',
  'events', 'evenementen', 'evenements',
  'cellar',
  'gift', 'cadeaubon',
  'booking', 'reservering', 'reservation',
  'about-us', 'contact', 'food-menu', 'wine-menu', 'jobs', 'sample-page',
  'sitemap', 'robots', 'brand', 'favicon', 'icon', 'apple-icon',
];

/** "Private Events!" -> "private-events". */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
