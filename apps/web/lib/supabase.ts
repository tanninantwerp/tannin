'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createTanninClient } from '@tannin/supabase';
import { SUPABASE_ANON_KEY } from '@/lib/supabase-keys';

/**
 * The public site's client, created on first use.
 *
 * Lazy for the same reason the admin's is: building it at module scope runs
 * during the production build, where the env vars are absent.
 *
 * The anon key is all the site ever gets, and row-level security is what makes
 * that safe - it can insert a booking request and read the blackout dates, and
 * it cannot read the guest book back. That asymmetry is deliberate: the table
 * of who is eating here tonight must not be one fetch away from the public.
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
