import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY } from '@/lib/supabase-keys';

/**
 * An anon Supabase client for server components and metadata.
 *
 * The browser client in `lib/supabase` is a `'use client'` module and cannot be
 * imported from a Server Component; this is the same anon key, built per call
 * with no session persistence, for the handful of server-side reads the public
 * site does (the opening hours behind the page and its search-result schema).
 * Row-level security is unchanged - anon still cannot read the guest book.
 */
export function serverDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
}
