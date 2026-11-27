/**
 * Where a bottle is from, as two separate facts.
 *
 * The cellar was transcribed from a printed list that prints one line of origin
 * per wine - sometimes a country ("Chile"), sometimes a region ("Burgundy"),
 * sometimes an appellation ("Auxey-Duresses"). All of it landed in `country`,
 * so the wine page's country filter offered sixty-nine options that mixed
 * countries with regions, and picking "France" missed every French wine whose
 * line happened to name Burgundy instead.
 *
 * This module is the single place that untangles the two. It is deliberately a
 * lookup rather than anything clever: a region only maps to a country when that
 * mapping is unambiguous, and anything genuinely uncertain is reported as
 * unresolved rather than guessed at. A wrong flag on a bottle is worse than an
 * honest "not filed yet" - a sommelier will notice the first and forgive the
 * second.
 *
 * Kept in core (no React, no DOM) so the website, the admin print sheets and any
 * future app all file the same bottle under the same country.
 */

/** The countries the cellar actually draws on. Anything here is already a country. */
const COUNTRIES = [
  'Argentina',
  'Australia',
  'Austria',
  'Belgium',
  'Bulgaria',
  'Canada',
  'Chile',
  'Croatia',
  'Cyprus',
  'Czech Republic',
  'France',
  'Georgia',
  'Germany',
  'Greece',
  'Hungary',
  'Italy',
  'Lebanon',
  'New Zealand',
  'Portugal',
  'Serbia',
  'Slovakia',
  'Slovenia',
  'South Africa',
  'Spain',
  'Switzerland',
  'USA',
] as const;

/**
 * Region, appellation or island to the country it sits in.
 *
 * Only entries whose country is not in doubt belong here. "Macedonia" is the
 * obvious counter-example and is listed as ambiguous below instead: it is both a
 * country (North Macedonia) and a wine region of northern Greece, and the
 * printed list does not say which.
 */
const REGION_TO_COUNTRY: Record<string, string> = {
  // France
  alsace: 'France',
  beaujolais: 'France',
  bergerac: 'France',
  bordeaux: 'France',
  burgundy: 'France',
  bourgogne: 'France',
  champagne: 'France',
  corsica: 'France',
  jura: 'France',
  languedoc: 'France',
  'languedoc roussillon': 'France',
  'languedoc-roussillon': 'France',
  loire: 'France',
  provence: 'France',
  rhone: 'France',
  roussillon: 'France',
  savoie: 'France',
  'southwest france': 'France',
  'south west france': 'France',
  'auxey-duresses': 'France',
  'montrecul aop': 'France',
  'montlouis sur loire': 'France',
  'muscadet-sevre-et-maine': 'France',
  'cotes du rhone': 'France',
  'cote du rhone': 'France',
  'vin de france': 'France',

  // Italy
  italy: 'Italy',
  piedmont: 'Italy',
  piemonte: 'Italy',
  puglia: 'Italy',
  marche: 'Italy',
  sicily: 'Italy',
  sicilia: 'Italy',
  tuscany: 'Italy',
  toscana: 'Italy',
  veneto: 'Italy',
  'friuli venezia giulia': 'Italy',
  'rosso di montalcino': 'Italy',
  'alto adige': 'Italy',

  // Spain
  aragon: 'Spain',
  'canary islands': 'Spain',
  'castilla la mancha': 'Spain',
  'castilla y leon': 'Spain',
  catalonia: 'Spain',
  galicia: 'Spain',
  madrid: 'Spain',
  mallorca: 'Spain',
  murcia: 'Spain',
  penedes: 'Spain',
  priorat: 'Spain',
  'rias baixas': 'Spain',
  'ribera del duero': 'Spain',
  rioja: 'Spain',
  tenerife: 'Spain',
  toro: 'Spain',

  // Portugal
  alentejo: 'Portugal',
  bairrada: 'Portugal',
  dao: 'Portugal',
  douro: 'Portugal',
  lisboa: 'Portugal',
  madeira: 'Portugal',
  'madeira (dry)': 'Portugal',
  setubal: 'Portugal',
  'tras-os-montes': 'Portugal',
  'vinho verde': 'Portugal',
  acores: 'Portugal',

  // Germany
  ahr: 'Germany',
  baden: 'Germany',
  franken: 'Germany',
  mosel: 'Germany',
  nahe: 'Germany',
  pfalz: 'Germany',
  rheingau: 'Germany',
  rheinhessen: 'Germany',
  wurttemberg: 'Germany',

  // Austria
  burgenland: 'Austria',
  kamptal: 'Austria',
  niederosterreich: 'Austria',
  steiermark: 'Austria',
  styria: 'Austria',
  wachau: 'Austria',

  // Greece
  crete: 'Greece',
  mantineia: 'Greece',
  nemea: 'Greece',
  peloponnese: 'Greece',
  santorini: 'Greece',

  // Elsewhere
  kakheti: 'Georgia',
  stajerska: 'Slovenia',
  kras: 'Slovenia',
  'itata valley': 'Chile',
  swartland: 'South Africa',
  'western cape': 'South Africa',
};

/**
 * Origins that name more than one country, or a place whose country the list
 * does not settle. These are surfaced as unresolved rather than filed under a
 * guess - see the module comment.
 */
const AMBIGUOUS = new Set(['slovenia x italy', 'macedonia']);

/**
 * Fold an origin string to a lookup key: lower case, accents stripped, and any
 * parenthetical dropped so "Vin de France (Rhône)" keys as "vin de france".
 */
function key(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .toLowerCase();
}

/** The parenthetical in "Vin de France (Rhône)", when there is one. */
function parenthetical(value: string): string | undefined {
  return /\(([^)]*)\)\s*$/.exec(value)?.[1]?.trim() || undefined;
}

const COUNTRY_BY_KEY = new Map(COUNTRIES.map((c) => [key(c), c]));

export interface ResolvedOrigin {
  /** The country, or null when it could not be settled without guessing. */
  country: string | null;
  /** The region, if one is known or was recovered from the country field. */
  region?: string | undefined;
  /** True when the origin names more than one country, or is genuinely unclear. */
  ambiguous: boolean;
}

/**
 * Split a wine's stored origin into a country and a region.
 *
 * Handles the three shapes the data actually takes:
 *  - country and region both correct already, which most rows are;
 *  - a region sitting in the country field with nothing in region, which is the
 *    bug this exists for - the region moves across and the country is looked up;
 *  - something that names two countries or an unclear place, which comes back
 *    with `country: null` and `ambiguous: true` so a caller can file it under
 *    "not filed yet" instead of inventing a flag for it.
 */
export function resolveWineOrigin(wine: {
  country?: string | null;
  region?: string | null;
}): ResolvedOrigin {
  const rawCountry = wine.country?.trim() ?? '';
  const rawRegion = wine.region?.trim() || undefined;

  if (!rawCountry) return { country: null, region: rawRegion, ambiguous: false };

  const k = key(rawCountry);

  if (AMBIGUOUS.has(k)) {
    return { country: null, region: rawRegion ?? rawCountry, ambiguous: true };
  }

  // Already a country: keep whatever region the row carries.
  const asCountry = COUNTRY_BY_KEY.get(k);
  if (asCountry) return { country: asCountry, region: rawRegion, ambiguous: false };

  // A region in the country field. Move it across and look the country up.
  const mapped = REGION_TO_COUNTRY[k];
  if (mapped) {
    // "Vin de France (Rhône)" carries the useful half in the brackets.
    const region = rawRegion ?? parenthetical(rawCountry) ?? rawCountry;
    return { country: mapped, region, ambiguous: false };
  }

  // Unknown place. Not a guess, and not silently dropped either.
  return { country: null, region: rawRegion ?? rawCountry, ambiguous: true };
}

/**
 * Repair text that was written as UTF-8 and read back as Windows-1252.
 *
 * The cellar import did this to a handful of rows, which is why the wine page
 * shows "Les Longeroies â€” Marsannay". The mapping is the usual suspects only -
 * anything not listed is left exactly as it is, because a repair table that
 * guesses is how you turn one broken row into ten.
 *
 * Longest sequences are replaced first: 'â€™' has to be matched before 'â€'.
 */
const MOJIBAKE: ReadonlyArray<readonly [string, string]> = [
  // Dashes become plain hyphens, matching the rest of the site.
  ['â€”', '-'],
  ['â€“', '-'],
  ['â€™', '’'],
  ['â€˜', '‘'],
  ['â€œ', '“'],
  ['â€', '”'],
  ['â€¦', '…'],
  ['â€', '”'],
  ['Ã©', 'é'],
  ['Ã¨', 'è'],
  ['Ãª', 'ê'],
  ['Ã«', 'ë'],
  ['Ã ', 'à'],
  ['Ã¢', 'â'],
  ['Ã´', 'ô'],
  ['Ã¶', 'ö'],
  ['Ã¼', 'ü'],
  ['Ã¤', 'ä'],
  ['Ã§', 'ç'],
  ['Ã±', 'ñ'],
  ['Ã¡', 'á'],
  ['Ã­', 'í'],
  ['Ã³', 'ó'],
  ['Ãº', 'ú'],
  ['ÃŸ', 'ß'],
  ['Â·', '·'],
  ['Â', ''],
];

/** Repair the mojibake sequences above; leave everything else untouched. */
export function repairEncoding<T extends string | null | undefined>(text: T): T {
  if (!text) return text;
  let out = text as string;
  // Cheap bail-out: these sequences all start with one of two lead bytes.
  if (!out.includes('Ã') && !out.includes('â')) return text;
  for (const [bad, good] of MOJIBAKE) out = out.split(bad).join(good);
  return out as T;
}
