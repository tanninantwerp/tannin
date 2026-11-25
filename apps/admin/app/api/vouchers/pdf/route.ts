import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderOnlineVoucherPdf, renderVoucherPdf } from '@tannin/voucher';
import { SUPABASE_ANON_KEY } from '@/lib/supabase-keys';

/**
 * A voucher's printable card, for staff: a paper voucher just sold over the
 * bar, or an online one a guest has lost.
 *
 * Same shape as the order email route: the caller's own token, not the service
 * key, so row-level security decides whether this person may see the voucher
 * at all - only staff with the `vouchers` permission can read the table.
 */

export const dynamic = 'force-dynamic';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = SUPABASE_ANON_KEY;

interface Row {
  code: string | null;
  amount_cents: number;
  valid_until: string | null;
  recipient_name: string | null;
  from_name: string | null;
  note: string | null;
  source: 'online' | 'bar';
  locale: 'en' | 'nl';
}

export async function GET(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Staff only.' }, { status: 403 });

  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'No such voucher.' }, { status: 404 });

  const asCaller = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await asCaller
    .from('gift_vouchers')
    .select('code, amount_cents, valid_until, recipient_name, from_name, note, source, locale')
    .eq('id', id)
    .maybeSingle();

  const v = data as Row | null;
  if (!v?.code || !v.valid_until) return NextResponse.json({ error: 'No such voucher.' }, { status: 404 });

  // The QR opens this admin's redeem screen, wherever it is hosted. A voucher
  // bought online reprints as the A4 page the guest was emailed; one sold over
  // the bar as the Canva card.
  const origin = new URL(req.url).origin;
  const render = v.source === 'online' ? renderOnlineVoucherPdf : renderVoucherPdf;
  const pdf = await render({
    code: v.code,
    amountCents: v.amount_cents,
    validUntil: v.valid_until,
    recipientName: v.recipient_name,
    fromName: v.from_name,
    note: v.note,
    redeemUrl: `${origin}/vouchers?code=${encodeURIComponent(v.code)}`,
    locale: v.locale,
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ta-nnin-gift-voucher-${v.code}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
