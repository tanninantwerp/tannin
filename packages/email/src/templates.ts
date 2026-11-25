import { VENUE } from '@tannin/core';
import type { BookingArea } from '@tannin/core';
import type { Message } from './send';

export type EmailLocale = 'en' | 'nl';

export interface BookingDetails {
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  notes?: string;
  locale?: EmailLocale;
  /** Absolute link to the guest's own manage page, if one has been minted. */
  manageUrl?: string;
  /** What the guest asked for - shown when set, omitted when there was no preference. */
  area?: BookingArea;
  /** Reservation reference, shown on the confirmation. */
  reservationCode?: string;
  /** Cancellation reference, shown on the cancellation notice. */
  cancellationCode?: string;
}

const TAG: Record<EmailLocale, string> = { en: 'en-GB', nl: 'nl-BE' };

export const INK = '#0d1011';
const PAPER = '#f3f0e9';
export const MUTED = '#6b6b66';

function longDate(iso: string, locale: EmailLocale): string {
  return new Intl.DateTimeFormat(TAG[locale], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${iso}T12:00:00Z`));
}

/** `18:45:00` from Postgres, `18:45` from the form. Both render as `18:45`. */
const hhmm = (time: string) => time.slice(0, 5);

export function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One layout for everything.
 *
 * Tables and inline styles, because email clients in 2026 are still email
 * clients - Outlook does not do flexbox and Gmail strips `<style>` blocks.
 * Nothing here needs a layout engine anyway.
 */
export function layout(bodyHtml: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${PAPER};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e2d9;">
        <tr><td style="background:${INK};padding:22px 28px;">
          <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:19px;letter-spacing:0.04em;color:${PAPER};">
            ${VENUE.name}
          </p>
          <p style="margin:4px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#a8bfae;">
            ${VENUE.strapline}
          </p>
        </td></tr>
        <tr><td style="padding:28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:${INK};">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:0 28px 28px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${MUTED};">
          ${VENUE.street}, ${VENUE.postcode} ${VENUE.city}<br>
          <a href="tel:${VENUE.phone.replace(/\s/g, '')}" style="color:${MUTED};">${VENUE.phone}</a> ·
          <a href="mailto:${VENUE.email}" style="color:${MUTED};">${VENUE.email}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** The booking, as a small block of facts. Repeated in every guest email. */
function detailRows(b: BookingDetails, locale: EmailLocale): string {
  const t = COPY[locale];
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;width:100%;border-top:1px solid #e5e2d9;">
    ${[
      [t.labelWhen, `${longDate(b.date, locale)}, ${hhmm(b.time)}`],
      [t.labelWho, String(b.partySize)],
      [t.labelName, escape(b.guestName)],
      // Only when the guest actually asked for one - most bookings have no
      // preference, and a row that always says "Area: no preference" is noise.
      ...(b.area ? [[t.labelArea, t.areaNames[b.area]]] : []),
    ]
      .map(
        ([label, value]) =>
          `<tr>
            <td style="padding:9px 0;border-bottom:1px solid #e5e2d9;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};">${label}</td>
            <td style="padding:9px 0;border-bottom:1px solid #e5e2d9;text-align:right;font-size:15px;color:${INK};">${value}</td>
          </tr>`,
      )
      .join('')}
  </table>`;
}

const COPY = {
  en: {
    labelWhen: 'When',
    labelWho: 'How many',
    labelName: 'Name',
    labelArea: 'Area',
    areaNames: { inside: 'Inside', terrace: 'Terrace', bar: 'Bar' } as Record<BookingArea, string>,
    receivedSubject: (d: string) => `We have your request - ${d}`,
    receivedGreeting: (n: string) => `Hello ${n},`,
    receivedBody:
      'Thank you - we have your request and someone will confirm it by email shortly. It is not a table yet, so do hold on to this rather than treat it as booked.',
    receivedNote: 'If anything changes in the meantime, just reply to this email.',
    confirmedSubject: (d: string) => `Your table is confirmed - ${d}`,
    confirmedGreeting: (n: string) => `Hello ${n},`,
    confirmedBody: 'That is booked. We will see you then.',
    confirmedNote:
      'If your plans change, reply to this email or call us - it frees the table for somebody else.',
    reservationLabel: 'Reservation',
    cancellationLabel: 'Cancellation',
    cancelledSubject: (d: string) => `Booking cancelled - ${d}`,
    cancelledGreeting: (n: string) => `Hello ${n},`,
    cancelledBody:
      'This booking is now cancelled. If that is a surprise, reply to this email or call us and we will put it right.',
    cancelledNote: 'Keep the cancellation number below in case you need to mention it.',
    manageLink: 'Cancel this booking',
    reminderDayBeforeSubject: (d: string) => `Tomorrow - ${d}`,
    reminderDayBeforeGreeting: (n: string) => `Hello ${n},`,
    reminderDayBeforeBody: 'A reminder that we have you in tomorrow.',
    reminderSameDaySubject: (d: string) => `Tonight - ${d}`,
    reminderSameDayGreeting: (n: string) => `Hello ${n},`,
    reminderSameDayBody: 'A reminder that we have you in today.',
    reminderNote: 'Can not make it after all? Reply to this email or call us - it frees the table for somebody else.',
  },
  nl: {
    labelWhen: 'Wanneer',
    labelWho: 'Met hoeveel',
    labelName: 'Naam',
    labelArea: 'Waar',
    areaNames: { inside: 'Binnen', terrace: 'Terras', bar: 'Bar' } as Record<BookingArea, string>,
    receivedSubject: (d: string) => `We hebben je aanvraag - ${d}`,
    receivedGreeting: (n: string) => `Dag ${n},`,
    receivedBody:
      'Bedankt - we hebben je aanvraag en iemand bevestigt ze binnenkort per e-mail. Het is dus nog geen tafel; beschouw dit nog niet als geboekt.',
    receivedNote: 'Verandert er intussen iets, antwoord dan gewoon op deze e-mail.',
    confirmedSubject: (d: string) => `Je tafel is bevestigd - ${d}`,
    confirmedGreeting: (n: string) => `Dag ${n},`,
    confirmedBody: 'Dat staat genoteerd. Tot dan.',
    confirmedNote:
      'Veranderen je plannen, antwoord dan op deze e-mail of bel ons - zo komt de tafel vrij voor iemand anders.',
    reservationLabel: 'Reservering',
    cancellationLabel: 'Annulering',
    cancelledSubject: (d: string) => `Reservering geannuleerd - ${d}`,
    cancelledGreeting: (n: string) => `Dag ${n},`,
    cancelledBody:
      'Deze reservering is geannuleerd. Klopt dat niet, antwoord dan op deze e-mail of bel ons en we zetten het recht.',
    cancelledNote: 'Bewaar het annuleringsnummer hieronder, voor het geval je ernaar moet verwijzen.',
    manageLink: 'Deze reservering annuleren',
    reminderDayBeforeSubject: (d: string) => `Morgen - ${d}`,
    reminderDayBeforeGreeting: (n: string) => `Dag ${n},`,
    reminderDayBeforeBody: 'Een herinnering dat we je morgen verwachten.',
    reminderSameDaySubject: (d: string) => `Vanavond - ${d}`,
    reminderSameDayGreeting: (n: string) => `Dag ${n},`,
    reminderSameDayBody: 'Een herinnering dat we je vandaag verwachten.',
    reminderNote: 'Lukt het toch niet? Antwoord op deze e-mail of bel ons - zo komt de tafel vrij voor iemand anders.',
  },
} as const;

function guestEmail(b: BookingDetails, kind: 'received' | 'confirmed'): Message {
  const locale = b.locale ?? 'en';
  const t = COPY[locale];
  const when = `${longDate(b.date, locale)}, ${hhmm(b.time)}`;

  const subject = kind === 'received' ? t.receivedSubject(when) : t.confirmedSubject(when);
  const greeting =
    kind === 'received' ? t.receivedGreeting(b.guestName) : t.confirmedGreeting(b.guestName);
  const body = kind === 'received' ? t.receivedBody : t.confirmedBody;
  const note = kind === 'received' ? t.receivedNote : t.confirmedNote;

  const details = detailRows(b, locale);
  const manage = b.manageUrl ?? '';
  // The reservation reference belongs on the confirmation - a request that is
  // still only pending has no table yet and so no number to quote.
  const reservation = kind === 'confirmed' && b.reservationCode ? b.reservationCode : '';

  const html = layout(
    `<p style="margin:0 0 14px;">${escape(greeting)}</p>
     <p style="margin:0 0 4px;">${escape(body)}</p>
     ${details}
     ${
       reservation
         ? `<p style="margin:6px 0 0;font-size:14px;"><span style="color:${MUTED};">${t.reservationLabel}:</span> ${escape(reservation)}</p>`
         : ''
     }
     <p style="margin:16px 0 0;color:${MUTED};font-size:13px;">${escape(note)}</p>
     ${
       manage
         ? `<p style="margin:14px 0 0;font-size:13px;">
              <a href="${escape(manage)}" style="color:${INK};">${t.manageLink}</a>
            </p>`
         : ''
     }`,
  );

  const text = [
    greeting,
    '',
    body,
    '',
    `${t.labelWhen}: ${when}`,
    `${t.labelWho}: ${b.partySize}`,
    ...(reservation ? [`${t.reservationLabel}: ${reservation}`] : []),
    '',
    note,
    ...(manage ? ['', `${t.manageLink}: ${manage}`] : []),
    '',
    `${VENUE.name} · ${VENUE.street}, ${VENUE.postcode} ${VENUE.city} · ${VENUE.phone}`,
  ].join('\n');

  return { to: b.guestEmail, subject, html, text, replyTo: VENUE.email };
}

/** "We have your request." Sent the moment the form is submitted. */
export const bookingReceived = (b: BookingDetails) => guestEmail(b, 'received');

/** "That is booked" - with the reservation number. Sent when a table is confirmed. */
export const bookingConfirmed = (b: BookingDetails) => guestEmail(b, 'confirmed');

/**
 * "Your booking is cancelled" - with the cancellation number.
 *
 * Sent to the guest whichever way a table goes: staff cancelling it from the
 * board, or the guest cancelling their own through the manage link. No manage
 * link of its own - there is nothing left to cancel.
 */
export function bookingCancelled(b: BookingDetails): Message {
  const locale = b.locale ?? 'en';
  const t = COPY[locale];
  const when = `${longDate(b.date, locale)}, ${hhmm(b.time)}`;

  const codes = [
    b.reservationCode ? [t.reservationLabel, b.reservationCode] : null,
    b.cancellationCode ? [t.cancellationLabel, b.cancellationCode] : null,
  ].filter(Boolean) as [string, string][];

  const html = layout(
    `<p style="margin:0 0 14px;">${escape(t.cancelledGreeting(b.guestName))}</p>
     <p style="margin:0 0 4px;">${escape(t.cancelledBody)}</p>
     ${detailRows(b, locale)}
     ${codes
       .map(
         ([label, value]) =>
           `<p style="margin:6px 0 0;font-size:14px;"><span style="color:${MUTED};">${label}:</span> ${escape(value)}</p>`,
       )
       .join('')}
     <p style="margin:16px 0 0;color:${MUTED};font-size:13px;">${escape(t.cancelledNote)}</p>`,
  );

  const text = [
    t.cancelledGreeting(b.guestName),
    '',
    t.cancelledBody,
    '',
    `${t.labelWhen}: ${when}`,
    `${t.labelWho}: ${b.partySize}`,
    ...codes.map(([label, value]) => `${label}: ${value}`),
    '',
    t.cancelledNote,
    '',
    `${VENUE.name} · ${VENUE.street}, ${VENUE.postcode} ${VENUE.city} · ${VENUE.phone}`,
  ].join('\n');

  return { to: b.guestEmail, subject: t.cancelledSubject(when), html, text, replyTo: VENUE.email };
}

/**
 * "See you tomorrow" / "see you tonight."
 *
 * Sent by the reminder cron, never by a guest or staff action, which is why it
 * takes a `kind` rather than being inferred from anything about the booking -
 * the same confirmed booking gets both, a day apart.
 */
export function bookingReminder(b: BookingDetails, kind: 'dayBefore' | 'sameDay'): Message {
  const locale = b.locale ?? 'en';
  const t = COPY[locale];
  const when = `${longDate(b.date, locale)}, ${hhmm(b.time)}`;

  const subject =
    kind === 'dayBefore' ? t.reminderDayBeforeSubject(when) : t.reminderSameDaySubject(when);
  const greeting =
    kind === 'dayBefore'
      ? t.reminderDayBeforeGreeting(b.guestName)
      : t.reminderSameDayGreeting(b.guestName);
  const body = kind === 'dayBefore' ? t.reminderDayBeforeBody : t.reminderSameDayBody;

  const manage = b.manageUrl ?? '';

  const html = layout(
    `<p style="margin:0 0 14px;">${escape(greeting)}</p>
     <p style="margin:0 0 4px;">${escape(body)}</p>
     ${detailRows(b, locale)}
     <p style="margin:16px 0 0;color:${MUTED};font-size:13px;">${escape(t.reminderNote)}</p>
     ${
       manage
         ? `<p style="margin:14px 0 0;font-size:13px;">
              <a href="${escape(manage)}" style="color:${INK};">${t.manageLink}</a>
            </p>`
         : ''
     }`,
  );

  const text = [
    greeting,
    '',
    body,
    '',
    `${t.labelWhen}: ${when}`,
    `${t.labelWho}: ${b.partySize}`,
    ...(b.area ? [`${t.labelArea}: ${t.areaNames[b.area]}`] : []),
    '',
    t.reminderNote,
    ...(manage ? ['', `${t.manageLink}: ${manage}`] : []),
    '',
    `${VENUE.name} · ${VENUE.street}, ${VENUE.postcode} ${VENUE.city} · ${VENUE.phone}`,
  ].join('\n');

  return { to: b.guestEmail, subject, html, text, replyTo: VENUE.email };
}

// Staff are no longer emailed. A waiting request and a guest's own
// cancellation both surface inside the admin now - a live toast on whatever
// screen someone is standing on, and a standing count of requests still to
// handle - so there is nothing to send them and no staff inbox to address.
