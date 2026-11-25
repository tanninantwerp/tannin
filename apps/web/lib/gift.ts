import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { giftVoucherEmail, send } from '@tannin/email';
import { renderOnlineVoucherPdf } from '@tannin/voucher';
import { SUPABASE_SERVICE_KEY } from '@/lib/supabase-keys';

/**
 * Selling gift vouchers through Stripe, server side.
 *
 * Everything here needs two secrets the public site otherwise does without: the
 * Stripe key, to take the money, and the Supabase service key, because a
 * stranger buying a voucher must be able to create one while the public key
 * can never read a voucher back. Both stay on the server; neither route that
 * uses them takes anything from the browser but the order itself.
 *
 * With either secret (or the publishable key) missing, the page says vouchers are sold at the bar and
 * the routes refuse politely, so the site can deploy before Stripe exists.
 */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? '';
// Public by design: Stripe.js needs it in the browser to draw the card fields.
export const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE = SUPABASE_SERVICE_KEY;

export const GIFT_ENABLED = Boolean(STRIPE_KEY && STRIPE_PUBLISHABLE_KEY && URL_ && SERVICE);

let stripeClient: Stripe | null = null;

export function stripe(): Stripe {
  if (!STRIPE_KEY) throw new Error('STRIPE_SECRET_KEY is not set.');
  stripeClient ??= new Stripe(STRIPE_KEY);
  return stripeClient;
}

export function serviceDb(): SupabaseClient {
  if (!URL_ || !SERVICE) throw new Error('NEXT_PUBLIC_SUPABASE_URL or the Supabase secret key is not set.');
  return createClient(URL_, SERVICE, { auth: { persistSession: false } });
}

export interface GiftVoucherRow {
  id: string;
  code: string | null;
  amount_cents: number;
  balance_cents: number;
  status: 'pending' | 'active' | 'void';
  recipient_name: string | null;
  from_name: string | null;
  note: string | null;
  buyer_email: string | null;
  recipient_email: string | null;
  recipient_emailed_at: string | null;
  locale: 'en' | 'nl';
  valid_until: string | null;
  stripe_session_id: string | null;
  emailed_at: string | null;
}

/**
 * Where the QR on the back of the card points: the admin's redeem screen with
 * the code filled in. `ADMIN_URL` is the admin's origin; without it the card
 * still carries the code, just no QR.
 */
export function redeemUrlFor(code: string): string | null {
  const admin = process.env.ADMIN_URL?.trim().replace(/\/$/, '');
  return admin ? `${admin}/vouchers?code=${encodeURIComponent(code)}` : null;
}

/** The A4 voucher made for the website, readable on a phone as well as printed. */
export function voucherPdf(v: GiftVoucherRow): Promise<Uint8Array> {
  return renderOnlineVoucherPdf({
    code: v.code!,
    amountCents: v.amount_cents,
    validUntil: v.valid_until!,
    recipientName: v.recipient_name,
    fromName: v.from_name,
    note: v.note,
    redeemUrl: redeemUrlFor(v.code!),
    locale: v.locale,
  });
}

/**
 * Mails the voucher to the buyer, and to the recipient if the buyer asked for
 * it to go straight to them - once each.
 *
 * The webhook and the thank-you page can both get here for the same voucher,
 * within the same second. Each send first claims its own `*_emailed_at` with a
 * conditional update, so only one of them sends; if the send then fails, the
 * claim is released and the next call - Stripe retries its webhooks for days -
 * tries again.
 */
async function sendOnce(db: SupabaseClient, v: GiftVoucherRow, to: 'buyer' | 'recipient'): Promise<void> {
  const column = to === 'buyer' ? 'emailed_at' : 'recipient_emailed_at';
  const address = to === 'buyer' ? v.buyer_email : v.recipient_email;
  const sentAt = to === 'buyer' ? v.emailed_at : v.recipient_emailed_at;
  if (!address || sentAt) return;

  const { data: claimed } = await db
    .from('gift_vouchers')
    .update({ [column]: new Date().toISOString() })
    .eq('id', v.id)
    .is(column, null)
    .select('id');
  if (!claimed?.length) return;

  const receipt = await send(
    giftVoucherEmail({
      to: address,
      code: v.code!,
      amountCents: v.amount_cents,
      validUntil: v.valid_until!,
      recipientName: v.recipient_name,
      locale: v.locale,
      pdf: await voucherPdf(v),
    }),
  );

  if (!receipt.sent) {
    console.error(`gift voucher ${v.id}: ${to} email not sent - ${receipt.reason} ${receipt.detail ?? ''}`);
    await db.from('gift_vouchers').update({ [column]: null }).eq('id', v.id);
  }
}

export type Fulfilment =
  | { state: 'unknown' }
  | { state: 'unpaid' }
  | { state: 'ready'; voucher: GiftVoucherRow };

/**
 * Turns a paid Checkout Session into a voucher: code, expiry, email.
 *
 * Asks Stripe rather than trusting whoever is calling, so the thank-you page
 * can run this from nothing but the session id in its URL. Safe to run any
 * number of times - activation and the email both happen once.
 */
export async function fulfil(sessionId: string): Promise<Fulfilment> {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.retrieve(sessionId);
  } catch {
    return { state: 'unknown' };
  }

  const voucherId = session.metadata?.voucher_id;
  if (!voucherId) return { state: 'unknown' };
  // Bancontact and cards settle at once; a slower method lands here as
  // `unpaid` and is finished by the `async_payment_succeeded` webhook.
  if (session.payment_status !== 'paid') return { state: 'unpaid' };

  const paymentIntent =
    typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);

  const db = serviceDb();
  const { data, error } = await db.rpc('activate_gift_voucher', {
    in_id: voucherId,
    in_payment_intent: paymentIntent,
  });
  const voucher = (Array.isArray(data) ? data[0] : data) as GiftVoucherRow | null;
  if (error || !voucher) {
    console.error(`gift voucher ${voucherId}: activation failed - ${error?.message ?? 'no row'}`);
    return { state: 'unknown' };
  }
  // The metadata came from Stripe, not the caller, so it can be trusted; this
  // only guards against a row that was somehow paid through another session.
  if (voucher.status !== 'active') return { state: 'unknown' };
  if (voucher.stripe_session_id && voucher.stripe_session_id !== session.id) return { state: 'unknown' };

  await sendOnce(db, voucher, 'buyer');
  await sendOnce(db, voucher, 'recipient');
  return { state: 'ready', voucher };
}
