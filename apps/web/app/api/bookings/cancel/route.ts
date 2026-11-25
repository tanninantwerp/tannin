import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { bookingCancelled, send } from '@tannin/email';
import type { BookingArea } from '@tannin/core';
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY } from '@/lib/supabase-keys';

/**
 * A guest cancelling their own table.
 *
 * The whole authorisation story is the token. It is a v4 uuid that only ever
 * appeared in an email sent to that guest, and the two database functions
 * behind this route are the only things anywhere that will accept one - neither
 * returns an email address or a phone number, so a leaked link exposes the
 * booking and nothing beyond it.
 *
 * Deliberately not a GET. Mail clients and chat apps fetch links to build
 * previews, and a cancellation that happens because WhatsApp rendered a card is
 * a lost table nobody chose to lose.
 *
 * Staff are not emailed about this. `cancel_booking_by_token` stamps the row
 * as cancelled *by the guest*, and the admin's live notifier turns that into a
 * "table freed" toast - which a staff member cancelling from the board does not
 * trigger, because that path stamps it as their own doing instead.
 */

export const dynamic = 'force-dynamic';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = SUPABASE_ANON_KEY;
const SERVICE = SUPABASE_SERVICE_KEY;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const token = body.token ?? '';
  // Rejected here so a malformed token never reaches Postgres as a cast error.
  if (!UUID.test(token)) return NextResponse.json({ error: 'Unknown booking.' }, { status: 404 });

  const db = createClient(URL_, ANON, { auth: { persistSession: false } });

  // Read before writing, because the cancellation email needs details the
  // update does not return.
  const { data: before, error: readError } = await db.rpc('booking_by_token', { token });
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const booking = Array.isArray(before) ? before[0] : before;
  if (!booking) return NextResponse.json({ error: 'Unknown booking.' }, { status: 404 });

  const { data: status, error } = await db.rpc('cancel_booking_by_token', { token });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The function refuses to reopen history - a seated or past booking comes
  // back with the status it already had.
  const cancelled = status === 'cancelled' && booking.status !== 'cancelled';

  if (cancelled && SERVICE) {
    // The guest gets a cancellation receipt with the number. Their email is not
    // returned by the token functions - a leaked link must never expose it - so
    // it is read here, server-side, with the service key, by the token we just
    // cancelled, and used only to send the mail.
    try {
      const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
      const { data: row } = await admin
        .from('bookings')
        .select('guest_name, guest_email, date, time, party_size, locale, requested_area, ref_code, cancel_code')
        .eq('manage_token', token)
        .maybeSingle();
      if (row?.guest_email) {
        const result = await send(
          bookingCancelled({
            date: row.date as string,
            time: row.time as string,
            partySize: row.party_size as number,
            guestName: row.guest_name as string,
            guestEmail: row.guest_email as string,
            locale: (row.locale === 'nl' ? 'nl' : 'en') as 'en' | 'nl',
            ...(row.requested_area ? { area: row.requested_area as BookingArea } : {}),
            ...(row.ref_code ? { reservationCode: row.ref_code as string } : {}),
            ...(row.cancel_code ? { cancellationCode: row.cancel_code as string } : {}),
          }),
        );
        if (!result.sent && result.reason === 'failed') {
          console.error(`guest cancellation receipt failed - ${result.detail}`);
        }
      }
    } catch (e) {
      // The table is already free; a missing receipt is not worth failing on.
      console.error('guest cancellation receipt error', e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ status, cancelled });
}
