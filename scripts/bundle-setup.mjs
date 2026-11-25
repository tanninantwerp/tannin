/**
 * Generates supabase/setup.sql - every migration and the seed, in order, as one
 * paste.
 *
 * The migrations are numbered because that is how they were written and how
 * they have to run. But somebody setting the database up is not maintaining
 * them, they are following a runbook, and "open ten files and paste each into
 * the SQL editor without losing your place" is a needlessly good way to end up
 * with a half-built schema and no idea which half.
 *
 * Generated rather than written, so it cannot drift: the migrations stay the
 * source of truth and this is only their concatenation. `npm test` checks the
 * committed copy still matches.
 *
 * Run: node scripts/bundle-setup.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase/migrations');

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const header = `-- Ta-nnin - the whole database, in one paste.
--
-- GENERATED FILE. Do not edit: run \`node scripts/bundle-setup.mjs\` instead.
-- The real source is supabase/migrations/, and this is those files joined in
-- order with the seed on the end.
--
-- Paste the lot into the Supabase SQL editor and press run. It is safe to run
-- again - every statement in here either creates something only if it is
-- missing or replaces what is there - so if you lose track of what you have
-- already done, running it once more is the right move rather than a risk.
--
-- The one thing it will overwrite: the seed at the bottom clears the menu, the
-- wine list and the bar list and re-inserts them from the repo. Anything Tawat
-- has changed in the admin since the last deploy goes with it. Everything else
-- - bookings, staff logins, the table plan, blackouts - is untouched.
--
-- Built from:
${files.map((f) => `--   ${f}`).join('\n')}
--   seed.sql
`;

const parts = files.map((f) => {
  const rule = '─'.repeat(Math.max(1, 72 - f.length));
  return `\n\n-- ╭─ ${f} ${rule}\n\n${readFileSync(join(dir, f), 'utf8').trimEnd()}`;
});

const seed = readFileSync(join(root, 'supabase/seed.sql'), 'utf8').trimEnd();
parts.push(`\n\n-- ╭─ seed.sql ${'─'.repeat(63)}\n\n${seed}`);

writeFileSync(join(root, 'supabase/setup.sql'), `${header}${parts.join('')}\n`);

const lines = (header + parts.join('')).split('\n').length;
console.log(`supabase/setup.sql - ${files.length} migrations + seed, ${lines} lines`);
