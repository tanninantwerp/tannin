/**
 * The Supabase keys, whichever variable holds the current one.
 *
 * The legacy anon and service_role keys (JWTs, "eyJ...") were disabled on
 * 2026-10-21. The Supabase integration on Vercel keeps writing them into
 * NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, and puts the
 * new keys ("sb_publishable_...", "sb_secret_...") in
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY. So prefer
 * whichever of the two is not a JWT, and fall back to whatever is set.
 *
 * The NEXT_PUBLIC_ reads are written out in full: Next only inlines
 * `process.env.NEXT_PUBLIC_X` into the browser bundle for that exact
 * expression. The secret is undefined in the browser, as it should be.
 */
function current(...keys: (string | undefined)[]): string {
  const set = keys.filter((k): k is string => Boolean(k));
  return set.find((k) => !k.startsWith('eyJ')) ?? set[0] ?? '';
}

export const SUPABASE_ANON_KEY = current(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

/** Server only. It bypasses row-level security. */
export const SUPABASE_SERVICE_KEY = current(
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.SUPABASE_SECRET_KEY,
);
