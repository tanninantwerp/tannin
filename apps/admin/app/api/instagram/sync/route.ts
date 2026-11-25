/**
 * Instagram sync cron endpoint.
 *
 * Vercel Cron hits this every day (see vercel.json). Uses the same CRON_SECRET
 * the booking-reminders route uses - set it in Vercel project settings and it
 * is attached automatically; without it the route runs unauthenticated (fine
 * for a read-only trigger on your own Supabase data).
 *
 * Manual trigger: POST /api/instagram/sync from the admin UI goes through the
 * server action in app/social/actions.ts instead, so this route is cron-only.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncInstagramPosts } from '@/lib/instagram';
import { SUPABASE_SERVICE_KEY } from '@/lib/supabase-keys';

export const dynamic = 'force-dynamic';

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } },
  );
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  if (!SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set.' }, { status: 500 });
  }

  try {
    const synced = await syncInstagramPosts(adminDb());
    return NextResponse.json({ synced });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[instagram/sync]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
