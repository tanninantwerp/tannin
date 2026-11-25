/**
 * Seeds real past events into the `events` table.
 *
 * Runs after migration 0039 has created the table. Uses the service-role key
 * (data writes, not DDL - the migration itself still has to be run in the SQL
 * editor). Idempotent: upserts on slug, so re-running updates rather than
 * duplicates. Images are left empty - Sacha adds photos from the admin.
 *
 * The Café Society entry is from the public listings for the 5 Sep 2025 edition
 * (happeningnext / allevents), not invented. Add more editions from the admin.
 *
 * The rows after it are archive entries reconstructed from @tannin_antwerp /
 * @cellar_antwerp posts, published with their post image (downloaded locally to
 * apps/web/public/events/instagram/<slug>.jpg - never a hotlinked CDN URL) and
 * a `source_url`/`source_account` that drive the "Seen on @…" link. Dates are
 * best-guesses from the posts and can still be corrected in the admin. To edit
 * the copy or a date, do it there or here and re-run - the upsert is on slug.
 *
 * Run: node scripts/seed-events.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(file) {
  const out = {};
  let text;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = { ...readEnv('apps/admin/.env.local'), ...process.env };
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !SERVICE) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in apps/admin/.env.local');
  process.exit(1);
}

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const events = [
  {
    slug: 'cafe-society-2025-09',
    title: 'Café Society',
    kind: 'cafe-society',
    starts_on: '2025-09-05',
    location: 'Antwerpen Zuid',
    summary:
      "The South of Antwerp's street party - thirteen venues open from 17:00, Ta-nnin among them.",
    body:
      "Café Society brings the South of Antwerp together a few times a year: a roving street party across the neighbourhood's cafés and wine bars. On 5 September 2025 thirteen venues - Ta-nnin, Revista, Giraffe, Pilar, Entrepôt du Congo, Fomu Café and more - opened their doors from 17:00 to 23:00, and the afterparty carried on late at Café Local.",
    image_url: null,
    published: true,
    position: 100,
  },

  // --- Archive candidates from Instagram. DRAFTS: confirm date + copy + image,
  // then publish from the admin. image_url stays null until a local image is
  // added; source_url/source_account power the "Seen on @…" link. ---
  {
    slug: 'tannin-final-night-2026-07',
    title: 'Final Night at Ta-nnin',
    kind: 'other',
    starts_on: '2026-07-19',
    location: 'Ta-nnin',
    summary: 'A Sunday final on the screen, cold wine on the table, the room in match-night mode.',
    body: 'Some Sundays the wine bar becomes a living room. The final went up on the screen, the glasses stayed cold, and the room watched together the way a neighbourhood does - less about the football than the being-here-for-it.',
    image_url: null,
    source_url: 'https://www.instagram.com/p/Da4-P8mjgx9/',
    source_account: 'tannin',
    published: true,
    position: 101,
  },
  {
    slug: 'troupis-mantinia-2026-06',
    title: 'Mantinia with Troupis Winery',
    kind: 'workshop',
    starts_on: '2026-06-17',
    location: 'Ta-nnin',
    summary: 'An evening around Mantinia and Moschofilero with the new generation of Troupis Winery.',
    body: 'A grower-led night on a region most guests meet for the first time here: Mantinia, in the Peloponnese, and its Moschofilero. Troupis brought the bottles and the story, and we poured through it slowly, no classroom required.',
    image_url: null,
    source_url: 'https://www.instagram.com/p/DZnSXGFsVbe/',
    source_account: 'tannin',
    published: true,
    position: 102,
  },
  {
    slug: 'reveur-alsace-2026-06',
    title: 'Vignoble du Rêveur with Emmanuelle Milan',
    kind: 'workshop',
    starts_on: '2026-06-11',
    location: 'Ta-nnin',
    summary: 'A biodynamic Alsace tasting with Emmanuelle Milan, co-founder of Vignoble du Rêveur.',
    body: 'Alsace, farmed biodynamically and made with a light hand - poured beside the person who makes it. Emmanuelle Milan walked the room through the wines of Vignoble du Rêveur: expressive, a little wild, and better for the company.',
    image_url: null,
    source_url: 'https://www.instagram.com/p/DZX2aeqstq4/',
    source_account: 'tannin',
    published: true,
    position: 103,
  },
  {
    slug: 'cellar-wine-odessos-2026-06',
    title: 'Wine Odessos at CE-LLAR',
    kind: 'cellar',
    starts_on: '2026-06-05',
    location: 'CE-LLAR',
    summary: 'Low-intervention wines from the Bulgarian coast, poured with the winemakers in the room.',
    body: 'The Bulgarian coast is not where most people start a wine list - which is exactly why it belongs at CE-LLAR. Wine Odessos brought their low-intervention bottles across the road, and it stayed a neighbourhood evening, not a masterclass.',
    image_url: null,
    source_url: 'https://www.instagram.com/p/DY2EdD9D6WD/',
    source_account: 'cellar',
    published: true,
    position: 104,
  },
  {
    slug: 'cafe-society-2026-05',
    title: 'Café Society at Ta-nnin',
    kind: 'cafe-society',
    starts_on: '2026-05-11',
    location: 'Ta-nnin',
    summary: 'One of those block nights: the room full, the street moving, the glasses not empty for long.',
    body: 'Café Society came round again and the South opened its doors. Ta-nnin poured and fed and stayed up late while the street moved between bars. Thank you to everyone who filled the room.',
    image_url: null,
    source_url: 'https://www.instagram.com/p/DYM0KSsjNcU/',
    source_account: 'tannin',
    published: true,
    position: 105,
  },
  {
    slug: 'cafe-society-sommlife-2026-05',
    title: 'Café Society: Sommlife, Decky & Hazzuko',
    kind: 'cafe-society',
    starts_on: '2026-05-04',
    location: 'Ta-nnin',
    summary: 'A Café Society night with Sommlife, Decky and Hazzuko bringing the room up.',
    body: 'A music-led edition: Sommlife, Decky and Hazzuko on the decks, the wine still doing the talking. High energy, wine-bar cool, the block outside as loud as the room.',
    image_url: null,
    source_url: 'https://www.instagram.com/p/DX7MLUVDVfL/',
    source_account: 'tannin',
    published: true,
    position: 106,
  },
  {
    slug: 'cellar-wine-route-2026-01',
    title: 'Wine Route with Hungry Antwerp',
    kind: 'cellar',
    starts_on: '2026-01-18',
    location: 'CE-LLAR & Antwerpen Zuid',
    summary: "CE-LLAR's first wine route with Hungry Antwerp, helped along by the first sun of the year.",
    body: "A loose Sunday route through the South with Hungry Antwerp: start at CE-LLAR, wander, taste, discover a few bottles, and finish somewhere around a Ta-nnin table. The first real sun of the year did the rest.",
    image_url: null,
    source_url: 'https://www.instagram.com/p/DTxKnIHjSGG/',
    source_account: 'cellar',
    published: true,
    position: 107,
  },
  {
    slug: 'cellar-opening-night-2025-12',
    title: 'CE-LLAR Opening Night',
    kind: 'cellar',
    starts_on: '2025-12-12',
    location: 'CE-LLAR',
    summary: 'The first proper night in the bottle shop across the road.',
    body: 'The bottle shop across the road opened its doors for the first time, and the room ran hot. Thank you to everyone who came to start it with us.',
    image_url: null,
    source_url: 'https://www.instagram.com/p/DSN7jMhDTA2/',
    source_account: 'cellar',
    published: true,
    position: 108,
  },
  {
    slug: 'cellar-first-vibrations-2025-12',
    title: 'The First Vibrations of CE-LLAR',
    kind: 'cellar',
    starts_on: '2025-12-06',
    location: 'CE-LLAR',
    summary: "A first look at the basement bottles, starting with Vignoble du Rêveur's Vibrations.",
    body: "The very first of the basement bottles - beginning, fittingly, with Vibrations from Vignoble du Rêveur. Not a launch so much as a shop quietly starting to breathe.",
    image_url: null,
    source_url: 'https://www.instagram.com/p/DR7XW2BCCGp/',
    source_account: 'cellar',
    published: true,
    position: 109,
  },
  {
    slug: 'cellar-french-tasting-2025-12',
    title: 'Anvers, on arrive',
    kind: 'cellar',
    starts_on: '2025-12-19',
    location: 'CE-LLAR',
    summary: 'A French tasting at CE-LLAR with Benoit and a table of joyful bottles.',
    body: 'A Friday of French bottles with Benoit - informal, generous, a little loud. "Anvers, on arrive": the wines had that energy, and so did the room.',
    image_url: null,
    source_url: 'https://www.instagram.com/p/DSZtDJRiJbW/',
    source_account: 'cellar',
    published: true,
    position: 110,
  },
  {
    slug: 'tannin-halloween-2025-10',
    title: 'Ta-nnin vs Halloween',
    kind: 'other',
    starts_on: '2025-10-31',
    location: 'Ta-nnin',
    summary: 'One night only: entrecôte for two, beef-tallow fries, dark mood, good wine, DJ late.',
    body: 'One dish, one night: entrecôte for two with beef-tallow fries, the lights down, the wine right, a DJ carrying it past midnight. Halloween, done the Ta-nnin way.',
    image_url: null,
    source_url: 'https://www.instagram.com/p/DPyUuuFDKK4/',
    source_account: 'tannin',
    published: true,
    position: 111,
  },
  {
    slug: 'tannin-slurp-2025-10',
    title: 'Ta-nnin at Slurp',
    kind: 'other',
    starts_on: '2025-10-24',
    location: 'Slurp Festival',
    summary: 'The first outing of the Ta-nnin foodtruck - fries, croquettes and festival pours.',
    body: "The Ta-nnin foodtruck's first proper outing: sweet-potato fries with truffle mayo, our croquettes, and good pours in a field. It turns out the room travels.",
    image_url: null,
    source_url: 'https://www.instagram.com/p/DQM3ouGDN-v/',
    source_account: 'tannin',
    published: true,
    position: 112,
  },
];

// Attach a local image to any event that has one saved under its slug in the
// web app's public folder (downloaded from the source post). Keeps the seed the
// source of truth for which image belongs to which event, by name.
const IMG_DIR = 'apps/web/public/events/instagram';
for (const e of events) {
  if (!e.image_url && existsSync(join(root, IMG_DIR, `${e.slug}.jpg`))) {
    e.image_url = `/events/instagram/${e.slug}.jpg`;
  }
}

async function main() {
  console.log(`Supabase: ${URL_}`);
  const withImg = events.filter((e) => e.image_url).length;
  console.log(`${events.length} events, ${withImg} with a local image.`);
  const { error } = await db.from('events').upsert(events, { onConflict: 'slug' });
  if (error) {
    if (/relation .*events.* does not exist/i.test(error.message)) {
      console.error('The `events` table is not there yet - run migration 0039 first.');
    } else {
      console.error(error);
    }
    process.exit(1);
  }
  console.log(`Seeded ${events.length} event(s): ${events.map((e) => e.slug).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
