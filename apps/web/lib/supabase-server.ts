import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY } from '@/lib/supabase-keys';

/**
 * A throwaway client for reading public content in a Server Component.
 *
 * Not `getDb()` from `lib/supabase.ts` - that one persists a session and
 * detects one in the URL, both meaningless on the server and wasted work for
 * a request that only ever reads menu, wine and bar-list rows RLS already
 * marks public. One client per request, nothing kept alive between them.
 */
export function getServerDb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    SUPABASE_ANON_KEY,
    { auth: { persistSession: false, detectSessionInUrl: false } },
  );
}
