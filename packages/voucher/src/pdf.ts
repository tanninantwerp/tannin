import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { voucherAmountLabel, voucherDateLabel } from '@tannin/core';
import { FONT_MEDIUM, FONT_REGULAR, TEMPLATE_PDF } from './assets.generated';
import { INK, drawQr, firstLine, fit, fromBase64, printable } from './draw';

/**
 * The gift voucher as a PDF: Tawat's own Canva card, with the blanks filled in.
 *
 * Writing onto the original rather than redrawing it means the online voucher
 * is the same object as the one sold over the bar - same paper, same gold
 * lines, same wine hero on the back - and a new design is a new export from
 * Canva, not a code change. The only thing tied to the layout is the table of
 * positions below.
 */

export interface VoucherPdfInput {
  code: string;
  amountCents: number;
  /** ISO date, `2027-10-28`. */
  validUntil: string;
  recipientName?: string | null;
  fromName?: string | null;
  note?: string | null;
  /**
   * Where the QR code on the back points: the admin's redeem screen with this
   * code filled in, so staff scan it with the bar phone. Left off, the back
   * carries only the code.
   */
  redeemUrl?: string | null;
}

/**
 * Where the top edge of the page is, in points. pdf-lib measures y upwards
 * from the media box's origin, and Canva's media box does not start at zero
 * (it runs from 8.25 to 306), so this is read off the template rather than
 * assumed to be the page height.
 */
export const TOP = 306;

/** `top` is the distance from the top of the page to the text's baseline, read off the template. */
export const at = (top: number) => TOP - top;

/** Where each blank is. Measured from the Canva export with `pdftotext -bbox`. */
const SLOTS = {
  recipient: { x: 46, y: at(168), width: 165, size: 11 },
  from: { x: 46, y: at(193), width: 165, size: 11 },
  note1: { x: 46, y: at(219.5), width: 165, size: 9 },
  note2: { x: 46, y: at(235), width: 165, size: 9 },
  // Just right of the euro sign printed in the value box.
  value: { x: 263, y: at(178.5), width: 100, size: 16 },
  code: { x: 246, y: at(210.5), width: 124, size: 12 },
  validUntil: { x: 246, y: at(237.5), width: 124, size: 10 },
} as const;

function write(
  page: PDFPage,
  font: PDFFont,
  text: string,
  slot: { x: number; y: number; width: number; size: number },
  shrink = true,
) {
  if (!text) return;
  const f = fit(text, font, slot.size, slot.width, shrink);
  page.drawText(f.text, { x: slot.x, y: slot.y, size: f.size, font, color: INK });
}

export async function renderVoucherPdf(input: VoucherPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(fromBase64(TEMPLATE_PDF));
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fromBase64(FONT_REGULAR), { subset: true });
  const medium = await doc.embedFont(fromBase64(FONT_MEDIUM), { subset: true });

  doc.setTitle(`Gift voucher ${input.code}`);
  doc.setAuthor('Ta-nnin');
  doc.setCreator('ta-nnin.be');
  doc.setProducer('ta-nnin.be');

  const [front, back] = doc.getPages();
  if (!front || !back) throw new Error('The voucher template should have a front and a back.');
  // A new export from Canva with a different page size would put every line
  // in the wrong place; better to fail loudly than to post a misprinted card.
  const frame = front.getMediaBox();
  if (Math.abs(frame.y + frame.height - TOP) > 1) {
    throw new Error('The voucher template has changed size - re-measure SLOTS in packages/voucher/src/pdf.ts.');
  }

  write(front, medium, printable(input.recipientName ?? '', medium), SLOTS.recipient);
  write(front, medium, printable(input.fromName ?? '', medium), SLOTS.from);

  const note = printable(input.note ?? '', regular);
  if (note) {
    const [one, two] = firstLine(note, regular, SLOTS.note1.size, SLOTS.note1.width);
    // Both lines at the same size, so the note reads as one paragraph; what
    // does not fit on the second is cut rather than shrunk.
    write(front, regular, one, SLOTS.note1, false);
    write(front, regular, two, SLOTS.note2, false);
  }

  write(front, medium, voucherAmountLabel(input.amountCents), SLOTS.value);
  write(front, medium, input.code, SLOTS.code);
  write(front, regular, voucherDateLabel(input.validUntil), SLOTS.validUntil);

  // The back: a small QR in the corner for staff, clear of the illustration,
  // with the code under it in case the phone is not to hand.
  const box = back.getMediaBox();
  const qrSize = 46;
  const qrX = box.x + box.width - qrSize - 18;
  const qrY = box.y + 26;
  if (input.redeemUrl) drawQr(back, input.redeemUrl, qrX, qrY, qrSize);
  const label = input.code;
  const labelSize = 6.5;
  const labelWidth = regular.widthOfTextAtSize(label, labelSize);
  back.drawText(label, {
    x: qrX + qrSize / 2 - labelWidth / 2,
    y: input.redeemUrl ? qrY - 12 : qrY,
    size: labelSize,
    font: regular,
    color: INK,
  });

  return doc.save();
}
