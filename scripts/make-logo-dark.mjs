/**
 * A two-tone logo for dark backgrounds, from the same artwork the favicon uses.
 *
 * `logo.png` is drawn for paper: a black wordmark and a teal "urban street
 * wine" line. The header and footer sit on ink, so they rendered it with
 * `brightness-0 invert`, which crushes every pixel to black and then flips it
 * to white - legible, but it throws the second colour away. The favicon keeps
 * both inks because it composites onto cream; this gives the dark surfaces the
 * same two-tone mark.
 *
 * Two things make it more than a colour swap:
 *
 * 1. The source has NO alpha antialiasing - every pixel is fully opaque or
 *    fully clear. Its edges were flattened against white, so the fringe around
 *    each stroke is opaque light grey. Recolouring those to paper would fatten
 *    every letterform with a pale halo. So coverage is derived from how far a
 *    pixel sits from white and written back as real alpha, which is what the
 *    fringe should have been all along.
 *
 * 2. Coverage is measured per ink. The teal is a mid-tone, so measuring it
 *    against black would leave the strapline half transparent; each class is
 *    normalised against its own pure-ink luminance instead.
 *
 * Run: node scripts/make-logo-dark.mjs
 */
import sharp from 'sharp';

const SOURCE = 'apps/web/public/brand/logo.png';
const OUT = 'apps/web/public/brand/logo-dark.png';

/** --color-paper and --color-green-pale, the two inks this mark gets on ink. */
const PAPER = { r: 0xf3, g: 0xf0, b: 0xe9 };
const GREEN = { r: 0xa8, g: 0xc6, b: 0xc2 };

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** The source's own teal, and therefore what full coverage means for it. */
const TEAL_LUM = lum(72, 120, 120);

async function main() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length);

  let wordmark = 0;
  let strapline = 0;

  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];

    if (a === 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }

    // The strapline is the only part with a colour cast; everything else is
    // the black wordmark and its grey fringe.
    const isTeal = g > r + 15 && b > r + 15;
    const ink = isTeal ? GREEN : PAPER;
    const full = isTeal ? 255 - TEAL_LUM : 255;
    const coverage = Math.max(0, Math.min(1, (255 - lum(r, g, b)) / full));

    out[i] = ink.r;
    out[i + 1] = ink.g;
    out[i + 2] = ink.b;
    out[i + 3] = Math.round(coverage * 255);
    if (coverage > 0.5) isTeal ? strapline++ : wordmark++;
  }

  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(OUT);

  console.log(`${OUT} - ${info.width}x${info.height}`);
  console.log(`  wordmark px:  ${wordmark} -> paper #f3f0e9`);
  console.log(`  strapline px: ${strapline} -> pale green #a8c6c2`);
}

main();
