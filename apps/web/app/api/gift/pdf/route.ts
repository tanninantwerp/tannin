import { GIFT_ENABLED, serviceDb, voucherPdf, type GiftVoucherRow } from '@/lib/gift';

/**
 * The voucher PDF, downloaded from the thank-you page.
 *
 * Keyed by the Stripe Checkout Session id, which only the buyer's browser was
 * sent back with - it is long and random, and Stripe treats it as private to
 * the payer, so it is as good a key as the email the same PDF is attached to.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('session_id') ?? '';
  if (!GIFT_ENABLED || !sessionId.startsWith('cs_')) return new Response('Not found.', { status: 404 });

  const { data } = await serviceDb()
    .from('gift_vouchers')
    .select('*')
    .eq('stripe_session_id', sessionId)
    .eq('status', 'active')
    .maybeSingle();

  const voucher = data as GiftVoucherRow | null;
  if (!voucher?.code) return new Response('Not found.', { status: 404 });

  const pdf = await voucherPdf(voucher);
  return new Response(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ta-nnin-gift-voucher-${voucher.code}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
