'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createTanninClient } from '@tannin/supabase';
import { SUPABASE_ANON_KEY } from '@/lib/supabase-keys';

/**
 * One client for the whole admin, created on first use.
 *
 * Deliberately lazy: building it at module scope runs during the production
 * build, where the env vars are absent, and the whole export fails. Nothing in
 * here is needed until a user actually interacts.
 *
 * Everything runs in the browser against the anon key, which is safe by design
 * - the row-level security in the migrations rejects every write unless the
 * signed-in user has a row in `staff`. The gate is Postgres, not this file.
 */
let client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (!client) {
    client = createTanninClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      anonKey: SUPABASE_ANON_KEY,
    });
  }
  return client;
}
