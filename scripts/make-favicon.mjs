/**
 * Generates the browser tab icon from the real logo artwork.
 *
 * Writes `apps/web/app/icon.png` and `apps/web/app/apple-icon.png`. Next's App
 * Router picks both up by filename and emits the <link> tags itself, so there
 * is nothing to wire in the layout - and the site had no icon at all before
 * this, which is why every page load logged a 404 for /favicon.ico.
 *
 * Two decisions worth recording:
 *
 * 1. **Paper, not ink.** The wordmark is black; on the ink background the brand
 *    otherwise uses it would be invisible. The menu-card stock (#f3f0e9) is
 *    already a brand surface, and a cream tile with dark letters stays legible
 *    against both a light and a dark browser chrome.
 *
 * 2. **Trimmed to the letterforms.** The source PNG carries wide transparent
 *    margins. Left in, the mark renders about half size in a 16px tab and turns
 *    to mush. Trimming to the ink and re-padding by a fixed ratio makes it as
 *    large as it can be while still reading as a bordered tile.
 *
 * Nothing is removed from the mark - the green "urban street wine" line is
 * still in there. It simply stops being resolvable somewhere around 24px, which
 * is true of any type at that size and is why the stacked TA-/NN/IN silhouette
 * is doing the identifying work.
 *
 * Run: node scripts/make-favicon.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'apps/web/public/brand/logo.png');
const appDir = join(root, 'apps/web/app');

/** Menu-card stock, from COLOURS.paper in @tannin/core. */
const PAPER = { r: 0xf3, g: 0xf0, b: 0xe9, alpha: 1 };

/** Share of the tile the mark occupies; the rest is breathing room. */
const INSET = 0.82;

async function build(size, out) {
  // Trim the transparent margin so the mark fills the tile.
  const trimmed = await sharp(source).trim().png().toBuffer();

  const inner = Math.round(size * INSET);
  const mark = await sharp(trimmed)
    .resize(inner, inner, { fit: 'contain', background: { ...PAPER, alpha: 0 } })
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: PAPER },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toFile(join(appDir, out));

  return `${out} ${size}x${size}`;
}

/**
 * A real .ico, wrapping a PNG.
 *
 * The <link> tags above are enough for any current browser, but anything that
 * ignores them still asks for /favicon.ico by convention - which is why the dev
 * log was full of 404s for it. ICO has allowed an embedded PNG since Vista, so
 * this is a 22-byte header in front of the PNG we already have rather than a
 * bitmap encoder and a new dependency.
 */
async function buildIco(out) {
  const size = 256;
  const inner = Math.round(size * INSET);
  const trimmed = await sharp(source).trim().png().toBuffer();
  const mark = await sharp(trimmed)
    .resize(inner, inner, { fit: 'contain', background: { ...PAPER, alpha: 0 } })
    .toBuffer();
  const png = await sharp({
    create: { width: size, height: size, channels: 4, background: PAPER },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer();

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(1, 4); // one image

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); // width, 0 means 256
  entry.writeUInt8(0, 1); // height, 0 means 256
  entry.writeUInt8(0, 2); // palette size
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(appDir, out), Buffer.concat([header, entry, png]));
  return `${out} ${size}x${size}`;
}

const written = [
  // The tab icon. One 512px PNG - browsers downscale it, and a single sharp
  // source beats a hand-tuned 16px that no high-DPI screen ever uses.
  await build(512, 'icon.png'),
  // Home-screen icon on iOS, which does not read icon.png.
  await build(180, 'apple-icon.png'),
  await buildIco('favicon.ico'),
];

for (const line of written) console.log(`wrote ${line}`);
