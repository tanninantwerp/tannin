import sharp from 'sharp';
const SRC = 'public/brand/logo.png';

// Trace the logo's exact edges as thin, uniform neon tube. Unlike a skeleton
// (which wanders off the letterforms at terminals and junctions), the outline
// follows the real font precisely — the tube IS the boundary of every stroke
// and counter, at one uniform width everywhere.

const base = sharp(SRC).ensureAlpha();
const { width: w, height: h } = await base.metadata();
const alpha = await base.clone().extractChannel('alpha').toColourspace('b-w').raw().toBuffer();

const fg = new Uint8Array(w * h);
const bg = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) {
  fg[i] = alpha[i] > 110 ? 1 : 0;
  bg[i] = fg[i] ? 0 : 1;
}

// Disc dilation.
function dilate(src, r) {
  const out = new Uint8Array(w * h);
  const offs = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) offs.push([dx, dy]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x] !== 1) continue;
      for (const [dx, dy] of offs) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) out[ny * w + nx] = 1;
      }
    }
  }
  return out;
}

// Boundary band of half-width r, centred exactly on the letter edge:
// pixels within r of BOTH an ink pixel and a background pixel. Width ~= 2r.
function band(r) {
  const di = dilate(fg, r);
  const db = dilate(bg, r);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = di[i] && db[i] ? 1 : 0;
  return out;
}

const tube = band(3); // ~6px tube on a 1132px master -> slim on screen
const core = band(1); // ~2px hairline, centred in the tube

async function save(bin, path) {
  const a = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) a[i] = bin[i] ? 255 : 0;
  const white = Buffer.alloc(w * h * 3, 255);
  await sharp(white, { raw: { width: w, height: h, channels: 3 } })
    .joinChannel(a, { raw: { width: w, height: h, channels: 1 } })
    .png().toFile(path);
}

await save(tube, 'public/brand/logo-tube.png');
await save(core, 'public/brand/logo-core.png');
console.log(`done ${w}x${h}: outline tube band r=3, core r=1`);
