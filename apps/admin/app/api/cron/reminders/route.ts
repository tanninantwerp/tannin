import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { addDays, toISODate } from '@tannin/core';
import { bookingReminder, send } from '@tannin/email';
import type { BookingArea } from '@tannin/core';
import { SUPABASE_SERVICE_KEY } from '@/lib/supabase-keys';

/**
 * The day-before and same-day reminder, in one daily pass.
 *
 * Triggered by Vercel Cron (see vercel.json) once a day. This needs the
 * service-role key - reading a guest's name and email to remind them is
 * exactly what row-level security exists to stop the anon key doing, so this
 * runs at the same trust level as /api/staff, not as a guest-facing route.
 *
 * Best-effort like every other send in this codebase: one guest's mail
 * bouncing is not a reason to stop working through the rest of the list.
 */

export const dynamic = 'force-dynamic';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE = SUPABASE_SERVICE_KEY;
/** The public site, not the admin - mirrors notify/route.ts's manage link. */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ta-nnin.be').replace(/\/$/, '');

function admin() {
  return createClient(URL_, SERVICE, { auth: { persistSession: false } });
}

interface Row {
  id: string;
  date: string;
  time: string;
  party_size: number;
  guest_name: string;
  guest_email: string | null;
  locale: 'en' | 'nl' | null;
  requested_area: BookingArea | null;
  manage_token: string;
  created_at: string;
}

function manageUrlFor(token: string, locale: 'en' | 'nl'): string {
  return locale === 'nl' ? `${SITE_URL}/nl/reservering/${token}` : `${SITE_URL}/booking/${token}`;
}

/**
 * Only bookings made before today are worth reminding: one booked this morning
 * for tonight just got a confirmation, and a reminder hours later would be
 * noise, not a service.
 *
 * Compared by Brussels calendar date, not a rolling hour count. The old rule
 * was a blunt 48-hour gap applied to both reminders, which left anything booked
 * roughly a day ahead falling through the crack between them - too late for the
 * day-before pass, too recent for the same-day one - and so reminded by
 * neither. "Created before the day this pass runs" has no such gap: a booking
 * made the day before its sitting misses the day-before reminder but still
 * catches the same-day one, and a same-day booking catches neither.
 */
function bookedBeforeToday(row: Row, today: string): boolean {
  return toISODate(new Date(row.created_at)) < today;
}

type ReminderColumn = 'reminded_day_before_at' | 'reminded_same_day_at';

async function sendReminders(
  db: ReturnType<typeof admin>,
  date: string,
  column: ReminderColumn,
  kind: 'dayBefore' | 'sameDay',
  today: string,
): Promise<{ sent: number; failed: number }> {
  const { data, error } = await db
    .from('bookings')
    .select('id, date, time, party_size, guest_name, guest_email, locale, requested_area, manage_token, created_at')
    .eq('date', date)
    .eq('status', 'confirmed')
    .is(column, null);

  if (error || !data) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const row of data as Row[]) {
    // A phone booking with no address on file - nobody to remind.
    if (!row.guest_email) continue;
    if (!bookedBeforeToday(row, today)) continue;

    const locale = row.locale === 'nl' ? 'nl' : 'en';
    const result = await send(
      bookingReminder(
        {
          date: row.date,
          time: row.time,
          partySize: row.party_size,
          guestName: row.guest_name,
          guestEmail: row.guest_email,
          locale,
          manageUrl: manageUrlFor(row.manage_token, locale),
          ...(row.requested_area ? { area: row.requested_area } : {}),
        },
        kind,
      ),
    );

    if (result.sent) {
      sent++;
      await db
        .from('bookings')
        .update({ [column]: new Date().toISOString() })
        .eq('id', row.id);
    } else {
      failed++;
      if (result.reason === 'failed') {
        console.error(`reminder (${kind}) for booking ${row.id}: ${result.detail}`);
      }
    }
  }

  return { sent, failed };
}

export async function GET(req: Request) {
  if (!SERVICE) {
    return NextResponse.json(
      { error: 'The server is missing SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 500 },
    );
  }

  // Vercel attaches this header automatically once CRON_SECRET is set on the
  // project - checked only when the secret is configured, same as the rest of
  // this codebase treats an unset secret as "weaker, but not off" (0009).
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const db = admin();
  const today = toISODate(new Date());
  const tomorrow = toISODate(addDays(new Date(), 1));

  const [dayBefore, sameDay] = await Promise.all([
    sendReminders(db, tomorrow, 'reminded_day_before_at', 'dayBefore', today),
    sendReminders(db, today, 'reminded_same_day_at', 'sameDay', today),
  ]);

  return NextResponse.json({ dayBefore, sameDay });
}
