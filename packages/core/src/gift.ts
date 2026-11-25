/**
 * Gift vouchers: the rules both the website and the admin agree on.
 *
 * Over the bar the voucher is Tawat's printed Canva card - CE-LLAR x TA-NIN, a
 * value, a code and a valid-until date. Online it is an A4 page built from the
 * same logos and artwork, emailed as a PDF that reads on a phone too. The database is what makes a
 * code real (see `supabase/migrations/0053_gift_vouchers.sql`); this file only
 * holds what the form, the email and the admin need to say the same thing.
 */

/** Amounts offered as one-tap buttons on the website, in whole euros. */
export const GIFT_PRESETS = [50, 100, 150, 250, 500] as const;

/**
 * The range a buyer can type in themselves, in whole euros.
 *
 * Any whole amount from 20 euros up. Whole euros only: a voucher for 37,50 is
 * almost always a typo. The top end (3000, Sacha, 2026-11-07) matches the database's
 * ceiling and limits what one stolen card can buy in a single voucher.
 */
export const GIFT_MIN_EUROS = 20;
export const GIFT_MAX_EUROS = 3000;

/**
 * How long a voucher stays valid. Belgian law sets a floor of one year for
 * gift vouchers and requires the end date to be printed on them, which is
 * exactly what the card's "valid until" line is for.
 */
export const VOUCHER_VALIDITY_MONTHS = 12;

/** Lengths the card has room for. The database checks the same numbers. */
export const GIFT_FIELD_LIMITS = {
  recipientName: 60,
  fromName: 60,
  // Two short lines on the card; much more than this gets cut off in the PDF.
  note: 70,
  email: 254,
} as const;

export interface GiftDraft {
  amountEuros?: number | undefined;
  recipientName?: string | undefined;
  fromName?: string | undefined;
  note?: string | undefined;
  buyerEmail?: string | undefined;
  /** Send the voucher straight to the recipient as well, at this address. */
  sendToRecipient?: boolean | undefined;
  recipientEmail?: string | undefined;
}

export type GiftErrorKey =
  | 'amount'
  | 'amountRange'
  | 'recipientName'
  | 'recipientNameTooLong'
  | 'fromName'
  | 'fromNameTooLong'
  | 'noteTooLong'
  | 'buyerEmail'
  | 'emailInvalid'
  | 'emailTooLong'
  | 'recipientEmail'
  | 'recipientEmailInvalid'
  | 'recipientEmailTooLong';

export type GiftErrors = Partial<Record<keyof GiftDraft, GiftErrorKey>>;

/** Same deliberately loose check the booking form uses - the mail server is the real validator. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates an order before it goes to Stripe. Runs in the browser for the
 * form and again on the server, so the two can never disagree.
 */
export function validateGiftOrder(d: GiftDraft): GiftErrors {
  const errors: GiftErrors = {};

  const amount = d.amountEuros;
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) errors.amountEuros = 'amount';
  else if (!Number.isInteger(amount) || amount < GIFT_MIN_EUROS || amount > GIFT_MAX_EUROS) {
    errors.amountEuros = 'amountRange';
  }

  const recipient = d.recipientName?.trim() ?? '';
  if (!recipient) errors.recipientName = 'recipientName';
  else if (recipient.length > GIFT_FIELD_LIMITS.recipientName) errors.recipientName = 'recipientNameTooLong';

  const from = d.fromName?.trim() ?? '';
  if (!from) errors.fromName = 'fromName';
  else if (from.length > GIFT_FIELD_LIMITS.fromName) errors.fromName = 'fromNameTooLong';

  if ((d.note?.trim().length ?? 0) > GIFT_FIELD_LIMITS.note) errors.note = 'noteTooLong';

  const email = d.buyerEmail?.trim() ?? '';
  if (!email) errors.buyerEmail = 'buyerEmail';
  else if (email.length > GIFT_FIELD_LIMITS.email) errors.buyerEmail = 'emailTooLong';
  else if (!EMAIL.test(email)) errors.buyerEmail = 'emailInvalid';

  if (d.sendToRecipient) {
    const to = d.recipientEmail?.trim() ?? '';
    if (!to) errors.recipientEmail = 'recipientEmail';
    else if (to.length > GIFT_FIELD_LIMITS.email) errors.recipientEmail = 'recipientEmailTooLong';
    else if (!EMAIL.test(to)) errors.recipientEmail = 'recipientEmailInvalid';
  }

  return errors;
}

/** The first voucher number. Codes count up from here, so the first sale is 10000. */
export const VOUCHER_CODE_FIRST = 10000;

/**
 * Whatever staff typed, as the stored form: five digits, or null when it
 * cannot be a code at all.
 *
 * Forgiving on purpose: spaces, a `TN` prefix or a dash left in all still find
 * the voucher.
 */
export function normaliseVoucherCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^TN/, '');
  return /^\d{5}$/.test(s) ? s : null;
}

/** `5000` -> `50`, `5050` -> `50,50`. The euro sign is printed on the card already. */
export function voucherAmountLabel(cents: number): string {
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(euros) : `${euros},${String(rest).padStart(2, '0')}`;
}

/** `2027-10-28` -> `28/10/2027`, the way dates are written in Belgium. */
export function voucherDateLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * An amount typed at the till, in cents: `12`, `12,50`, `12.5`, `€ 12,50`.
 * Null for anything that is not a positive amount with at most two decimals.
 */
export function parseEuroInput(input: string): number | null {
  const s = input.replace(/[€\s]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 ? cents : null;
}
