import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { send } from '@tannin/email';
import { VENUE } from '@tannin/core';
import { SUPABASE_ANON_KEY } from '@/lib/supabase-keys';

/**
 * Mails the buyer their own shopping list, and remembers the address.
 *
 * Same shape as the booking notifier next door, and for the same reason: the
 * route carries the caller's own token rather than the service key, so Postgres
 * decides whether this person is staff. A route that writes settings on the
 * strength of an unverified request is a route anyone can write settings with.
 *
 * The list arrives in the request rather than being read back from the
 * database. It is what the buyer is looking at, quantities and all, and
 * re-reading it here would risk mailing something subtly different from what
 * was on screen when they pressed Send.
 */

export const dynamic = 'force-dynamic';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = SUPABASE_ANON_KEY;

interface Row {
  name?: string;
  unit?: string | null;
  note?: string | null;
  quantity?: number;
}
interface Group {
  label?: string;
  rows?: Row[];
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Staff only.' }, { status: 403 });

  let body: { to?: string; groups?: Group[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const to = (body.to ?? '').trim();
  const groups = (body.groups ?? []).filter((g) => (g.rows ?? []).length > 0);
  // Deliberately loose: the mail server is the real validator, and a buyer
  // fighting a regex on their phone at the cash and carry is a worse outcome
  // than a bounce.
  if (!to || !to.includes('@')) return NextResponse.json({ error: 'That does not look like an email address.' }, { status: 400 });
  if (groups.length === 0) return NextResponse.json({ error: 'The shopping list is empty.' }, { status: 400 });

  const asCaller = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: auth } = await asCaller.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'Staff only.' }, { status: 403 });

  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Brussels',
  }).format(new Date());

  const line = (r: Row) =>
    `${r.quantity ?? ''} ${r.unit ?? ''} ${r.name ?? ''}${r.note ? ` (${r.note})` : ''}`.replace(/\s+/g, ' ').trim();

  const text = [
    `${VENUE.name} - shopping list`,
    today,
    '',
    ...groups.flatMap((g) => [g.label ?? '', ...(g.rows ?? []).map((r) => `  [ ] ${line(r)}`), '']),
  ].join('\n');

  const html = [
    `<p style="font:14px/1.5 system-ui,sans-serif">${escape(VENUE.name)} - shopping list<br><span style="color:#666">${escape(today)}</span></p>`,
    ...groups.map((g) =>
      [
        `<h3 style="font:600 12px/1.4 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.12em;color:#666;margin:18px 0 6px">${escape(g.label ?? '')}</h3>`,
        '<table style="border-collapse:collapse;font:14px/1.5 system-ui,sans-serif">',
        ...(g.rows ?? []).map(
          (r) =>
            `<tr><td style="padding:4px 10px 4px 0;text-align:right;white-space:nowrap">${escape(String(r.quantity ?? ''))} ${escape(r.unit ?? '')}</td>` +
            `<td style="padding:4px 0">${escape(r.name ?? '')}${r.note ? ` <span style="color:#888">${escape(r.note)}</span>` : ''}</td></tr>`,
        ),
        '</table>',
      ].join(''),
    ),
  ].join('');

  const result = await send({
    to,
    subject: `${VENUE.name} shopping list - ${today}`,
    html,
    text,
  });

  if (!result.sent) {
    return NextResponse.json(
      { sent: false, error: result.reason === 'not-configured' ? 'Mail is not configured on this deployment.' : 'The mail server refused it.' },
      { status: 502 },
    );
  }

  // Remembered for next time. RLS lets staff write this one key and no other,
  // so a failure here is not worth failing the send over - the mail is already
  // gone and the address is a convenience.
  await asCaller.from('app_settings').upsert({ key: 'order_email', value: to }, { onConflict: 'key' });

  return NextResponse.json({ sent: true });
}
