import nodemailer, { type Transporter } from 'nodemailer';
import { VENUE } from '@tannin/core';

/**
 * Sending, with a deliberate refusal to be load-bearing.
 *
 * Every function here returns a result rather than throwing. A booking that
 * reaches the database but fails to send a receipt is a mildly annoying
 * problem; a booking that is *rejected* because the mail provider had a bad
 * minute is a lost table. The caller is expected to log the failure and carry
 * on, and the admin shows the request either way.
 *
 * That also means the site works with no mail configured at all, which is the
 * state it ships in until someone fills in the SMTP variables.
 *
 * Two transports, both Brevo on the free tier. With BREVO_API_KEY set, mail
 * goes through Brevo's HTTP API: that is what runs on Cloudflare Workers, where
 * a plain fetch is cheaper and surer than an SMTP socket. Otherwise it falls
 * back to plain SMTP through Nodemailer, as on Vercel. Guests are the only audience now - staff are told what needs
 * doing inside the admin, not by email - so there is a single sender and no
 * staff inbox to configure here.
 */

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: 'not-configured' | 'failed'; detail?: string };

const HOST = process.env.SMTP_HOST ?? '';
const PORT = Number(process.env.SMTP_PORT ?? '587');
const USER = process.env.SMTP_USER ?? '';
const PASS = process.env.SMTP_PASS ?? '';
const BREVO_API_KEY = process.env.BREVO_API_KEY ?? '';

/**
 * Who the mail comes from. Must exactly match a sender verified in Brevo, or
 * every send is rejected - there is no sensible default to fall back to, so an
 * unset address counts as "not configured" rather than a guess that bounces.
 */
const FROM = process.env.BOOKING_FROM_EMAIL ?? '';

let transporter: Transporter | null = null;

function transport(): Transporter | null {
  // All four are needed to send anything worth sending; any one missing and we
  // are in the ships-with-no-mail state described above.
  if (!HOST || !USER || !PASS || !FROM) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      // 465 is implicit TLS; 587 (Brevo's default) opens plain and upgrades
      // with STARTTLS, which Nodemailer does when `secure` is false.
      secure: PORT === 465,
      auth: { user: USER, pass: PASS },
    });
  }
  return transporter;
}

export interface Message {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Files to attach - the gift voucher PDF, so far the only one. */
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
}

/** Brevo's transactional email endpoint. */
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

async function sendViaApi(message: Message): Promise<SendResult> {
  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: VENUE.name, email: FROM },
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
        ...(message.attachments?.length
          ? {
              attachment: message.attachments.map((a) => ({
                name: a.filename,
                content: Buffer.from(a.content).toString('base64'),
              })),
            }
          : {}),
      }),
    });
    if (!res.ok) {
      return { sent: false, reason: 'failed', detail: `Brevo ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const body = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { sent: true, id: body.messageId ?? '' };
  } catch (e) {
    return { sent: false, reason: 'failed', detail: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function send(message: Message): Promise<SendResult> {
  if (BREVO_API_KEY && FROM) return sendViaApi(message);
  const mailer = transport();
  if (!mailer) return { sent: false, reason: 'not-configured' };

  try {
    const info = await mailer.sendMail({
      from: `${VENUE.name} <${FROM}>`,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.content),
              contentType: a.contentType,
            })),
          }
        : {}),
    });

    return { sent: true, id: info.messageId ?? '' };
  } catch (e) {
    return { sent: false, reason: 'failed', detail: e instanceof Error ? e.message : 'unknown' };
  }
}
