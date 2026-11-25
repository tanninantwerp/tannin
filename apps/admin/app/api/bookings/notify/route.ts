import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { bookingCancelled, bookingConfirmed, send } from '@tannin/email';
import { SUPABASE_ANON_KEY } from '@/lib/supabase-keys';

/**
 * Tells a guest what was decided about their request.
 *
 * Split from the status update itself on purpose. The update runs from the
 * browser against row-level security and is the thing that must not fail; this
 * is a follow-up that may. If mail is down, the booking is still confirmed and
 * the board still shows it - somebody just has to pick up the phone.
 *
 * No service-role key here. The route carries the caller's own token, so
 * Postgres decides whether they are allowed to read that booking, exactly as it
 * would in the browser. A route that reads the guest book with the service key
 * on the strength of an unverified id is a route that leaks the guest book.
 */

export const dynamic = 'force-dynamic';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = SUPABASE_ANON_KEY;

/**
 * The public site, not the admin - the link is for the guest.
 *
 * `||`, not `??`: set-but-blank in the Vercel dashboard is an empty string
 * rather than undefined, and a manage link of `/booking/abc` with no origin is
 * not a link at all once it is sitting in somebody's inbox.
 */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://ta-nnin.be').replace(/\/$/, '');

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Staff only.' }, { status: 403 });

  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const { id, status } = body;
  if (!id || (status !== 'confirmed' && status !== 'cancelled')) {
    // Seated and no-show are recorded, not announced. Emailing somebody to say
    // they did not turn up is not a thing a wine bar should do.
    return NextResponse.json({ error: 'Nothing to send for that status.' }, { status: 400 });
  }

  const asCaller = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: auth } = await asCaller.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'Staff only.' }, { status: 403 });

  // RLS restricts this select to staff, so a non-staff caller gets nothing back
  // rather than somebody else's booking.
  const { data: row, error } = await asCaller
    .from('bookings')
    .select('date, time, party_size, guest_name, guest_email, guest_phone, notes, locale, manage_token, ref_code, cancel_code')
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'No such booking.' }, { status: 404 });
  // A phone booking with no address on file - nothing to mail.
  if (!row.guest_email) return NextResponse.json({ sent: false, reason: 'no-email' });

  const details = {
    date: row.date as string,
    time: row.time as string,
    partySize: row.party_size as number,
    guestName: row.guest_name as string,
    guestEmail: row.guest_email as string,
    ...(row.guest_phone ? { guestPhone: row.guest_phone as string } : {}),
    ...(row.notes ? { notes: row.notes as string } : {}),
    locale: (row.locale === 'nl' ? 'nl' : 'en') as 'en' | 'nl',
    // Mirrors the website's routing table: the Dutch route is translated, so a
    // Dutch guest's link has to be too. Kept in step by the test in
    // apps/web - if that word ever changes, this is the other place to change.
    manageUrl:
      row.locale === 'nl'
        ? `${SITE_URL}/nl/reservering/${row.manage_token}`
        : `${SITE_URL}/booking/${row.manage_token}`,
    // The reservation number rides the confirmation; the cancellation number is
    // set by the database the moment the status flips, so it is already on the
    // row this route just read back.
    ...(row.ref_code ? { reservationCode: row.ref_code as string } : {}),
    ...(row.cancel_code ? { cancellationCode: row.cancel_code as string } : {}),
  };

  const result = await send(
    status === 'confirmed' ? bookingConfirmed(details) : bookingCancelled(details),
  );

  if (!result.sent) {
    return NextResponse.json(
      { sent: false, reason: result.reason, detail: result.detail },
      // Not an error the caller did anything about, and the status change has
      // already happened. 200 with `sent: false` so the board can say so.
      { status: 200 },
    );
  }

  return NextResponse.json({ sent: true });
}
