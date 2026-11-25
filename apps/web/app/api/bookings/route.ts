import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { IN_HOUSE_BOOKING_ENABLED, MAX_PARTY_ONLINE, validateBooking, windowFor } from '@tannin/core';
import type { ServiceWindow } from '@tannin/core';
import { bookingConfirmed, bookingReceived, send } from '@tannin/email';
import { fetchServiceWindows } from '@tannin/supabase';
import { clientKey } from '@/lib/client-key';
import { manageUrlFor } from '@/lib/manage-url';
import { SUPABASE_ANON_KEY } from '@/lib/supabase-keys';

/**
 * Requesting a table.
 *
 * The form used to insert straight into Postgres from the browser, which worked
 * - row-level security allows exactly that - but there is no way to send an
 * email from a browser without shipping the mail provider's key to it. So the
 * insert moved here, where the key can stay on the server.
 *
 * The anon key is still what talks to the database. This route deliberately
 * does not use the service-role key: it is doing precisely what an anonymous
 * visitor is allowed to do, and there is no reason to hand it the ability to do
 * more. The row-level security policy remains the real guard.
 */

export const dynamic = 'force-dynamic';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = SUPABASE_ANON_KEY;

const AREAS = ['inside', 'terrace', 'bar'] as const;
type Area = (typeof AREAS)[number];

interface Body {
  date?: string;
  time?: string;
  partySize?: number;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  notes?: string;
  locale?: string;
  area?: string;
}

export async function POST(request: Request) {
  if (!IN_HOUSE_BOOKING_ENABLED) return new Response('Not found.', { status: 404 });
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  // The bookings table and the email templates only know English and Dutch so
  // far, so a guest booking from the French site is confirmed in English.
  const locale = body.locale === 'nl' ? 'nl' : 'en';

  // Dropped rather than rejected when it is not one of the three - a stale
  // client sending something odd should not be the reason a booking fails
  // outright, the same forgiveness `book_table` itself gives an unknown area.
  const area: Area | undefined = AREAS.includes(body.area as Area) ? (body.area as Area) : undefined;

  const draft = {
    date: body.date,
    time: body.time,
    partySize: Number(body.partySize),
    guestName: body.guestName,
    guestEmail: body.guestEmail,
    guestPhone: body.guestPhone,
    notes: body.notes,
  };

  /*
   * Validated again here, not because the form skipped it but because the form
   * is not the only thing that can post to this URL. The same pure function
   * runs in both places, so the answers cannot disagree.
   */
  const errors = validateBooking(draft);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'Those details are not valid.', errors }, { status: 400 });
  }

  if (draft.partySize > MAX_PARTY_ONLINE) {
    return NextResponse.json({ error: 'Too large to book online.' }, { status: 400 });
  }

  /*
   * Said out loud rather than left to createClient, which throws on empty
   * strings and turns a missing env var into an unexplained 500. The guest sees
   * the same "something went wrong" either way; this is for whoever reads the
   * log afterwards and has to guess why a fresh deployment takes no bookings.
   */
  if (!URL_ || !ANON) {
    console.error('booking rejected: NEXT_PUBLIC_SUPABASE_URL or _ANON_KEY is missing');
    return NextResponse.json({ error: 'Bookings are not configured.' }, { status: 503 });
  }

  const db = createClient(URL_, ANON, { auth: { persistSession: false } });

  // The database enforces the horizon and the party ceiling; this catches the
  // one thing it cannot know - that we are shut on that weekday. Read against
  // the live hours, falling back to the built-in week if they cannot be read,
  // so a transient error never turns away a booking on a day we are open.
  let windows: ServiceWindow[] | undefined;
  try {
    windows = await fetchServiceWindows(db);
  } catch {
    windows = undefined;
  }
  if (!windowFor(draft.date!, windows)) {
    return NextResponse.json({ error: 'We are closed that day.' }, { status: 400 });
  }

  /*
   * `book_table` allocates and inserts in one transaction, under a lock on the
   * date. That is what makes automatic confirmation safe: two people hitting
   * Book at the same instant cannot both be given the last table.
   *
   * It confirms when a single table fits the party and falls back to `pending`
   * when none does - a seven, say, with nothing bigger than a six. That is a
   * table somebody can usually make by pushing two together, which is a
   * judgement for a person rather than a rule.
   */
  const { data, error } = await db.rpc('book_table', {
    on_date: draft.date!,
    at_time: draft.time!,
    party: draft.partySize,
    in_name: draft.guestName!.trim(),
    in_email: draft.guestEmail!.trim(),
    in_phone: draft.guestPhone?.trim() || null,
    in_note: draft.notes?.trim() || null,
    in_lang: locale,
    in_client: clientKey(request),
    in_area: area ?? null,
  });

  if (error) {
    /*
     * The throttle, raised with its own SQLSTATE so it does not have to be
     * told apart from other failures by matching on English. It is the one
     * error here a guest can do something about - waiting, or ringing - so it
     * gets its own status and its own message rather than "that did not send".
     */
    if (error.code === 'TN001') {
      return NextResponse.json({ error: 'Too many bookings.', reason: 'throttled' }, { status: 429 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const booking = Array.isArray(data) ? data[0] : data;
  if (!booking) {
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 });
  }

  const confirmed = booking.status === 'confirmed';

  /*
   * The table is booked at this point. Mail is best-effort from here on: a
   * receipt that fails to send is worth logging and nothing more, because the
   * request is already in the diary and visible in the admin. Refusing the
   * booking over a mail failure would throw away the thing we actually wanted.
   */
  const details = {
    date: draft.date!,
    time: draft.time!,
    partySize: draft.partySize,
    guestName: draft.guestName!.trim(),
    guestEmail: draft.guestEmail!.trim(),
    ...(draft.guestPhone?.trim() ? { guestPhone: draft.guestPhone.trim() } : {}),
    ...(draft.notes?.trim() ? { notes: draft.notes.trim() } : {}),
    locale,
    manageUrl: manageUrlFor(booking.manage_token, locale),
    ...(area ? { area } : {}),
  } as const;

  /*
   * The guest gets the outcome - confirmed if a table was allocated, "we have
   * your request" if one was not. Telling somebody their request is being
   * considered when the table is already theirs is the exact thing automatic
   * confirmation exists to stop.
   *
   * Nobody is emailed about it but the guest. A waiting request is staff's to
   * act on, and they see it live in the admin - a toast as it lands and a
   * standing count of what still needs a decision - so a staff email would be
   * a second copy of something already in front of them.
   */
  // The reservation number goes on the confirmation only. The anon key cannot
  // read the row back (row-level security forbids listing the guest book), so a
  // booking that confirmed itself fetches just its own code - which is not a
  // secret - by the token it was handed.
  let reservationCode: string | undefined;
  if (confirmed) {
    const { data: ref } = await db.rpc('booking_ref_by_token', { token: booking.manage_token });
    if (typeof ref === 'string') reservationCode = ref;
  }

  const receipt = await send(
    confirmed ? bookingConfirmed({ ...details, reservationCode }) : bookingReceived(details),
  );

  if (!receipt.sent && receipt.reason === 'failed') {
    console.error(`booking ${booking.id}: receipt failed - ${receipt.detail}`);
  }

  return NextResponse.json({ id: booking.id, status: booking.status, confirmed, emailed: receipt.sent });
}
