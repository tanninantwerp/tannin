import { NextResponse } from 'next/server';
import { validateGiftOrder, voucherAmountLabel } from '@tannin/core';
import { getPathname } from '@/i18n/navigation';
import { GIFT_ENABLED, serviceDb, stripe } from '@/lib/gift';
import { SITE_URL } from '@/lib/site';

/**
 * Starting a gift voucher purchase.
 *
 * Stores the order as a `pending` voucher - no code, nothing to redeem - and
 * opens a Checkout Session for our own payment step on /gift (`ui_mode:
 * 'elements'`): the browser gets the session's client secret, never a Stripe
 * page. The payment methods are fixed here rather than in the dashboard, so
 * the form shows exactly card (which brings Apple Pay and Google Pay) and
 * Bancontact, the same in test and live mode.
 *
 * The amount is taken from the validated order, never from anything Stripe
 * sends back, and the voucher only becomes real once Stripe says the money is
 * in (see `fulfil` in lib/gift).
 */

export const dynamic = 'force-dynamic';

interface Body {
  amountEuros?: number;
  recipientName?: string;
  fromName?: string;
  note?: string;
  buyerEmail?: string;
  sendToRecipient?: boolean;
  recipientEmail?: string;
  locale?: string;
}

export async function POST(request: Request) {
  if (!GIFT_ENABLED) {
    return NextResponse.json({ error: 'Online vouchers are not switched on yet.' }, { status: 503 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const locale = body.locale === 'nl' ? 'nl' : 'en';
  const order = {
    amountEuros: Number(body.amountEuros),
    recipientName: body.recipientName?.trim() ?? '',
    fromName: body.fromName?.trim() ?? '',
    note: body.note?.trim() ?? '',
    buyerEmail: body.buyerEmail?.trim() ?? '',
    sendToRecipient: body.sendToRecipient === true,
    recipientEmail: body.recipientEmail?.trim() ?? '',
  };

  const errors = validateGiftOrder(order);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'Those details are not valid.', errors }, { status: 400 });
  }

  const cents = order.amountEuros * 100;
  const db = serviceDb();

  const { data: voucher, error } = await db
    .from('gift_vouchers')
    .insert({
      amount_cents: cents,
      balance_cents: cents,
      source: 'online',
      recipient_name: order.recipientName,
      from_name: order.fromName,
      note: order.note || null,
      buyer_email: order.buyerEmail,
      recipient_email: order.sendToRecipient ? order.recipientEmail : null,
      locale,
    })
    .select('id')
    .single();

  if (error || !voucher) {
    console.error(`gift checkout: could not store the order - ${error?.message}`);
    return NextResponse.json({ error: 'Could not start the payment.' }, { status: 500 });
  }

  const thanks = getPathname({ locale, href: '/gift/thanks' });
  const label = voucherAmountLabel(cents);

  try {
    const session = await stripe().checkout.sessions.create(
      {
        mode: 'payment',
        ui_mode: 'elements',
        allowed_payment_method_types: ['card', 'bancontact'],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: cents,
              product_data: {
                name: locale === 'nl' ? `Cadeaubon € ${label}` : `Gift voucher € ${label}`,
                description: 'Ta-nnin × CE-LLAR, Volkstraat, Antwerpen',
              },
            },
          },
        ],
        customer_email: order.buyerEmail,
        client_reference_id: voucher.id,
        metadata: { voucher_id: voucher.id },
        payment_intent_data: { metadata: { voucher_id: voucher.id }, description: 'Gift voucher' },
        locale,
        // Where Stripe lands the buyer after paying, including on the way back
        // from a bank's 3D Secure or Bancontact page.
        return_url: `${SITE_URL}${thanks}?session_id={CHECKOUT_SESSION_ID}`,
        // An hour, not Stripe's default 24: someone who goes back to change the
        // details opens a new order, and the old one should void soon after.
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      },
      // A double-click must not open two payments for one order.
      { idempotencyKey: `gift-${voucher.id}` },
    );

    await db.from('gift_vouchers').update({ stripe_session_id: session.id }).eq('id', voucher.id);
    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (e) {
    console.error(`gift checkout ${voucher.id}: Stripe refused - ${e instanceof Error ? e.message : e}`);
    await db.from('gift_vouchers').update({ status: 'void', void_reason: 'Checkout could not start' }).eq('id', voucher.id);
    return NextResponse.json({ error: 'Could not start the payment.' }, { status: 502 });
  }
}
