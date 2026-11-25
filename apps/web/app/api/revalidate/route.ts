/**
 * On-demand ISR revalidation for the homepage social strip, and for the
 * texts and pages edited in the admin.
 *
 * The admin POSTs here after any social post change so visitors see new
 * content immediately instead of waiting up to an hour for ISR to expire.
 *
 * Set REVALIDATE_SECRET on both the web and admin Vercel projects to the
 * same random string. Without it the route still works but is open - fine
 * for internal use, same pattern as the booking cron.
 */

import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { CONTENT_TAG } from '@/lib/site-texts';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (secret && req.headers.get('x-revalidate-secret') !== secret) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  // Revalidate every locale root so the cached homepage is rebuilt on next visit.
  revalidatePath('/en');
  revalidatePath('/nl');
  revalidatePath('/fr');
  // Texts and pages from the admin appear on every page, so drop them all.
  revalidateTag(CONTENT_TAG);
  revalidatePath('/', 'layout');

  return NextResponse.json({ revalidated: true });
}
