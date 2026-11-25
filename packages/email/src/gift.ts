import { SHOP, VENUE, voucherAmountLabel, voucherDateLabel } from '@tannin/core';
import type { Message } from './send';
import { INK, MUTED, escape, layout, type EmailLocale } from './templates';

export interface GiftVoucherDetails {
  /** Who the voucher is mailed to: the buyer, or the recipient if they asked for it to go straight to them. */
  to: string;
  code: string;
  amountCents: number;
  /** ISO date. */
  validUntil: string;
  recipientName?: string | null;
  locale?: EmailLocale;
  /** The filled-in card. */
  pdf: Uint8Array;
}

const COPY = {
  en: {
    subject: (amount: string) => `Your Ta-nnin gift voucher - € ${amount}`,
    greeting: 'Thank you,',
    body: (who: string) =>
      `Your gift voucher${who ? ` for ${who}` : ''} is attached, ready to print or forward. It can be spent at ${VENUE.name} and at ${SHOP.name} across the road, in one go or over several visits.`,
    labelValue: 'Value',
    labelCode: 'Code',
    labelValid: 'Valid until',
    note: 'Lost the PDF? Reply to this email with the code and we will send it again.',
  },
  nl: {
    subject: (amount: string) => `Je cadeaubon van Ta-nnin - € ${amount}`,
    greeting: 'Bedankt,',
    body: (who: string) =>
      `Je cadeaubon${who ? ` voor ${who}` : ''} zit in de bijlage, klaar om af te drukken of door te sturen. Hij is geldig bij ${VENUE.name} en bij ${SHOP.name} aan de overkant, in één keer of verspreid over meerdere bezoeken.`,
    labelValue: 'Waarde',
    labelCode: 'Code',
    labelValid: 'Geldig tot',
    note: 'PDF kwijt? Antwoord op deze e-mail met de code en we sturen hem opnieuw.',
  },
} as const;

/** The voucher, to the person who paid for it, with the card attached. */
export function giftVoucherEmail(v: GiftVoucherDetails): Message {
  const locale = v.locale ?? 'en';
  const t = COPY[locale];
  const amount = voucherAmountLabel(v.amountCents);
  const who = v.recipientName?.trim() ?? '';

  const rows: [string, string][] = [
    [t.labelValue, `€ ${amount}`],
    [t.labelCode, v.code],
    [t.labelValid, voucherDateLabel(v.validUntil)],
  ];

  const html = layout(
    `<p style="margin:0 0 14px;">${escape(t.greeting)}</p>
     <p style="margin:0 0 4px;">${escape(t.body(who))}</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;width:100%;border-top:1px solid #e5e2d9;">
       ${rows
         .map(
           ([label, value]) =>
             `<tr>
               <td style="padding:9px 0;border-bottom:1px solid #e5e2d9;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};">${label}</td>
               <td style="padding:9px 0;border-bottom:1px solid #e5e2d9;text-align:right;font-size:15px;color:${INK};">${escape(value)}</td>
             </tr>`,
         )
         .join('')}
     </table>
     <p style="margin:16px 0 0;color:${MUTED};font-size:13px;">${escape(t.note)}</p>`,
  );

  const text = [
    t.greeting,
    '',
    t.body(who),
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    t.note,
    '',
    `${VENUE.name} · ${VENUE.street}, ${VENUE.postcode} ${VENUE.city} · ${VENUE.phone}`,
  ].join('\n');

  return {
    to: v.to,
    subject: t.subject(amount),
    html,
    text,
    replyTo: VENUE.email,
    attachments: [{ filename: `ta-nnin-gift-voucher-${v.code}.pdf`, content: v.pdf, contentType: 'application/pdf' }],
  };
}
