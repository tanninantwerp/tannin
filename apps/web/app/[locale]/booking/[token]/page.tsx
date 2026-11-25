import { notFound } from 'next/navigation';
import { IN_HOUSE_BOOKING_ENABLED } from '@tannin/core';
import { createClient } from '@supabase/supabase-js';
import { setRequestLocale } from 'next-intl/server';
import { SiteNav } from '@/components/SiteNav';
import { IN_HOUSE_BOOK } from '@/components/nav-links';
import { ManageBooking } from '@/components/ManageBooking';
import { SiteFooter } from '@/components/SiteFooter';
import { SUPABASE_ANON_KEY } from '@/lib/supabase-keys';

/**
 * A guest's own booking, reached from the link in their email.
 *
 * Rendered on the server so the page arrives with the booking already on it -
 * somebody who followed a link from an email should not watch a spinner.
 *
 * Never indexed and never cached: the URL contains the token.
 */
export const dynamic = 'force-dynamic';

export const metadata = { robots: { index: false, follow: false } };

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = SUPABASE_ANON_KEY;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ManageBookingPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  if (!IN_HOUSE_BOOKING_ENABLED) notFound();
  const { locale, token } = await params;
  setRequestLocale(locale);

  if (!UUID.test(token)) notFound();

  const db = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await db.rpc('booking_by_token', { token });

  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) notFound();

  return (
    <>
      <SiteNav book={IN_HOUSE_BOOK} />
      <main>
        <ManageBooking
          token={token}
          booking={{
            date: row.date,
            time: row.time,
            partySize: row.party_size,
            guestName: row.guest_name,
            status: row.status,
          }}
        />
      </main>
      <SiteFooter />
    </>
  );
}
