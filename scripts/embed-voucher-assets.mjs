/**
 * Generates packages/voucher/src/assets.generated.ts - the voucher template
 * and its fonts as base64 strings.
 *
 * Embedded rather than read from disk at runtime: a serverless function only
 * ships the files its bundler can see, and a PDF read through `fs` is the
 * classic file that works locally and is missing on Vercel. A string inside a
 * module cannot go missing. `npm test` checks the committed copy is current.
 *
 * Run: node scripts/embed-voucher-assets.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'packages/voucher/assets');
const out = join(root, 'packages/voucher/src/assets.generated.ts');

const b64 = (file) => readFileSync(join(assets, file)).toString('base64');

const source = `// GENERATED FILE. Do not edit: run \`node scripts/embed-voucher-assets.mjs\`.
// The sources are in packages/voucher/assets/.

export const TEMPLATE_PDF = '${b64('gift-voucher-template.pdf')}';
export const FONT_REGULAR = '${b64('WorkSans-Regular.ttf')}';
export const FONT_MEDIUM = '${b64('WorkSans-Medium.ttf')}';
export const FONT_DISPLAY = '${b64('Voces-Regular.ttf')}';
`;

writeFileSync(out, source);
console.log(`${out.replace(root + '/', '')} - ${Math.round(source.length / 1024)} KB`);
