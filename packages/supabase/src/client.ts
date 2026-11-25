import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * One factory, both platforms.
 *
 * Next.js exposes browser env as `NEXT_PUBLIC_*` and Expo as `EXPO_PUBLIC_*`,
 * so the caller passes the values in rather than this module reaching for a
 * global that only exists on one of them.
 */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /** React Native must be handed AsyncStorage; the browser uses localStorage. */
  storage?: {
    getItem: (key: string) => Promise<string | null> | string | null;
    setItem: (key: string, value: string) => Promise<void> | void;
    removeItem: (key: string) => Promise<void> | void;
  };
  /** False on the server, where there is no URL to parse a session out of. */
  detectSessionInUrl?: boolean;
}

export function createTanninClient({
  url,
  anonKey,
  storage,
  detectSessionInUrl = true,
}: SupabaseConfig): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and fill in the project URL and anon key.',
    );
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl,
      ...(storage ? { storage: storage as never } : {}),
    },
  });
}
