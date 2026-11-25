import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { GIFT_ENABLED, fulfil, serviceDb, stripe } from '@/lib/gift';

/**
 * Stripe telling us something happened. Point the webhook in the Stripe
 * dashboard at `/api/stripe/webhook` and subscribe it to:
 *
 *   checkout.session.completed                 paid by card, Bancontact, wallet
 *   checkout.session.async_payment_succeeded   paid by a slower method
 *   checkout.session.expired                   abandoned at the payment page
 *   charge.refunded                            refunded from the dashboard
 *
 * The signature is checked against STRIPE_WEBHOOK_SECRET before anything is
 * read, so nobody can post a fake "paid" here. Anything that fails answers 500,
 * which makes Stripe retry - for days - so a database blip delays a voucher
 * rather than losing it.
 */

export const dynamic = 'force-dynamic';

const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

export async function POST(request: Request) {
  if (!GIFT_ENABLED || !SECRET) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature') ?? '';
  // The raw body, byte for byte: the signature is over exactly what was sent.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, SECRET);
  } catch {
    return NextResponse.json({ error: 'Bad signature.' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const result = await fulfil(event.data.object.id);
        if (result.state === 'unknown' && event.data.object.metadata?.voucher_id) {
          return NextResponse.json({ error: 'Could not issue the voucher.' }, { status: 500 });
        }
        break;
      }

      case 'checkout.session.expired': {
        // Nobody paid. The pending row never had a code; closing it keeps the
        // register free of orders that will never complete.
        const id = event.data.object.metadata?.voucher_id;
        if (id) {
          await serviceDb()
            .from('gift_vouchers')
            .update({ status: 'void', voided_at: new Date().toISOString(), void_reason: 'Not paid' })
            .eq('id', id)
            .eq('status', 'pending');
        }
        break;
      }

      case 'charge.refunded': {
        // A full refund cancels the voucher. A partial one is a judgement call
        // (some of it already spent?) left to whoever issued it, in the admin.
        const charge = event.data.object;
        const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        if (pi && charge.refunded) {
          await serviceDb()
            .from('gift_vouchers')
            .update({ status: 'void', voided_at: new Date().toISOString(), void_reason: 'Refunded in Stripe' })
            .eq('stripe_payment_intent', pi)
            .eq('status', 'active');
        }
        break;
      }
    }
  } catch (e) {
    console.error(`stripe webhook ${event.type} ${event.id}: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: 'Failed.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
