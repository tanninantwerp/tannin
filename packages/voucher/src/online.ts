import {
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { SHOP, VENUE, voucherAmountLabel, voucherDateLabel } from '@tannin/core';
import { FONT_DISPLAY, FONT_MEDIUM, FONT_REGULAR, TEMPLATE_PDF } from './assets.generated';
import { INK, covers, drawQr, firstLine, fit, fromBase64, printable } from './draw';
import { TOP } from './pdf';
import type { VoucherPdfInput } from './pdf';

/**
 * The voucher bought on the website: one portrait A4 page.
 *
 * The back and the front of the Canva card on one page (Sacha, 2026-11-09):
 * the red wine hero from the back, large and centred at the top; under it the
 * front of the card, with its gold labels, lines and two columns, filled in;
 * and the black TA-NNIN and CE-LLAR logos small in the bottom corners, each
 * over its Instagram handle.
 *
 * It is opened on a phone at the bar or printed at home, so the code, date
 * and QR are big enough to read at arm's length, and the page prints edge to
 * edge on A4 with no cropping.
 *
 * The logos and the wine hero are lifted straight out of the Canva template,
 * so the two vouchers stay one brand and a new Canva export updates both.
 */

export interface OnlineVoucherPdfInput extends VoucherPdfInput {
  locale?: 'en' | 'nl' | null;
}

const W = 595.28;
const H = 841.89;
const CENTRE = W / 2;
/** Layout is measured from the top of the page, as in the design; pdf-lib's y runs upwards. */
const T = (fromTop: number) => H - fromTop;

const GOLD = rgb(157 / 255, 108 / 255, 44 / 255);
const LIGHT_GOLD = rgb(214 / 255, 193 / 255, 147 / 255);
const LINE = rgb(0.81, 0.81, 0.81);
const HANDLE = rgb(0.33, 0.33, 0.33);

const MARGIN = 52;
const LABEL_SIZE = 8;
/** The two gold rules, measured from the top, and the height of the details between them. */
const TOP_RULE = 404;
const BOTTOM_RULE = 726;
const DETAILS_H = 200;
const COL_GAP = 28;
const COL_W = (W - 2 * MARGIN - 2 * COL_GAP) / 2;
const LEFT_X = MARGIN;
const RIGHT_X = W - MARGIN - COL_W;

/** Regions of the Canva template to reuse, in its own coordinates (see `TOP` in pdf.ts). */
const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  right,
  bottom: TOP - bottom,
  top: TOP - top,
});
const CELLAR_LOGO = box(56, 46, 227, 84);
const TANNIN_LOGO = box(291, 29.5, 363, 107);
const HERO = box(100, 19, 319, 278);

const COPY = {
  en: {
    for: 'A GIFT FOR',
    from: 'FROM',
    note: 'NOTE',
    value: 'VOUCHER VALUE',
    code: 'VOUCHER CODE',
    validUntil: 'VALID UNTIL',
    thanks: ['THANK YOU FOR SUPPORTING YOUR', 'NEIGHBOURHOOD WINE HERO'],
  },
  nl: {
    for: 'EEN CADEAU VOOR',
    from: 'VAN',
    note: 'BERICHT',
    value: 'WAARDE',
    code: 'CODE',
    validUntil: 'GELDIG TOT',
    thanks: ['BEDANKT OM JE', 'WIJNHELD IN DE BUURT TE STEUNEN'],
  },
} as const;

function centred(
  page: PDFPage,
  text: string,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB,
  width = W - 2 * MARGIN,
  spacing = 0,
) {
  if (!text) return;
  const f = fit(text, font, size, width - spacing * text.length, true, size * 0.6);
  const textWidth = font.widthOfTextAtSize(f.text, f.size) + spacing * (f.text.length - 1);
  if (spacing) page.pushOperators(pushGraphicsState(), setCharacterSpacing(spacing));
  page.drawText(f.text, { x: CENTRE - textWidth / 2, y, size: f.size, font, color });
  if (spacing) page.pushOperators(popGraphicsState());
}

function spaced(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, spacing: number, color: RGB) {
  page.pushOperators(pushGraphicsState(), setCharacterSpacing(spacing));
  page.drawText(text, { x, y, size, font, color });
  page.pushOperators(popGraphicsState());
}

/** A gold label over a grey line, as on the front of the card. Returns the line's y. */
function field(page: PDFPage, label: string, x: number, top: number, width: number, labelFont: PDFFont, lineAt: number) {
  spaced(page, label, x, T(top + 8), labelFont, LABEL_SIZE, 2.2, GOLD);
  page.drawLine({ start: { x, y: T(lineAt) }, end: { x: x + width, y: T(lineAt) }, thickness: 0.6, color: LINE });
}

/** The thin gold rule with a diamond in the middle, as on the Canva card. */
function rule(page: PDFPage, y: number, halfWidth: number) {
  page.drawLine({ start: { x: CENTRE - halfWidth, y }, end: { x: CENTRE - 8, y }, thickness: 0.6, color: LIGHT_GOLD });
  page.drawLine({ start: { x: CENTRE + 8, y }, end: { x: CENTRE + halfWidth, y }, thickness: 0.6, color: LIGHT_GOLD });
  const d = 3.2;
  page.drawSvgPath(`M 0 ${-d} L ${d} 0 L 0 ${d} L ${-d} 0 Z`, { x: CENTRE, y, color: rgb(201 / 255, 163 / 255, 92 / 255) });
}

/** A name in Voces when it has every letter, else Work Sans, which covers all of Latin. */
function nameOnLine(page: PDFPage, raw: string | null | undefined, x: number, baseline: number, width: number, display: PDFFont, fallback: PDFFont) {
  const text = (raw ?? '').trim();
  if (!text) return;
  const font = covers(text, display) ? display : fallback;
  const f = fit(printable(text, font), font, 19, width, true, 10);
  page.drawText(f.text, { x, y: T(baseline), size: f.size, font, color: INK });
}

export async function renderOnlineVoucherPdf(input: OnlineVoucherPdfInput): Promise<Uint8Array> {
  const t = COPY[input.locale === 'nl' ? 'nl' : 'en'];

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fromBase64(FONT_REGULAR), { subset: true });
  const medium = await doc.embedFont(fromBase64(FONT_MEDIUM), { subset: true });
  const display = await doc.embedFont(fromBase64(FONT_DISPLAY), { subset: true });

  doc.setTitle(`Gift voucher ${input.code}`);
  doc.setAuthor(VENUE.name);
  doc.setCreator('ta-nnin.be');
  doc.setProducer('ta-nnin.be');

  const template = await PDFDocument.load(fromBase64(TEMPLATE_PDF));
  const [front, back] = template.getPages();
  if (!front || !back) throw new Error('The voucher template should have a front and a back.');
  const frame = front.getMediaBox();
  if (Math.abs(frame.y + frame.height - TOP) > 1) {
    throw new Error('The voucher template has changed size - re-measure the regions in packages/voucher/src/online.ts.');
  }
  const [cellar, tannin] = await doc.embedPages([front, front], [CELLAR_LOGO, TANNIN_LOGO]);
  const hero = await doc.embedPage(back, HERO);
  if (!cellar || !tannin) throw new Error('Could not lift the logos out of the voucher template.');

  const page = doc.addPage([W, H]);

  // The back of the card: the red wine hero, large and centred.
  const heroH = 330;
  const heroW = (hero.width / hero.height) * heroH;
  page.drawPage(hero, { x: CENTRE - heroW / 2, y: T(40 + heroH), width: heroW, height: heroH });

  rule(page, T(TOP_RULE), 160);

  // The front of the card: two columns split by a thin gold line.
  // Centred between the two gold rules.
  const top = TOP_RULE + (BOTTOM_RULE - TOP_RULE - DETAILS_H) / 2;
  const bottom = top + DETAILS_H;
  page.drawLine({ start: { x: CENTRE, y: T(top) }, end: { x: CENTRE, y: T(bottom) }, thickness: 0.6, color: LIGHT_GOLD });

  // Left: who it is for, who it is from, the note.
  field(page, t.for, LEFT_X, top, COL_W, medium, top + 46);
  nameOnLine(page, input.recipientName, LEFT_X, top + 38, COL_W, display, medium);
  field(page, t.from, LEFT_X, top + 66, COL_W, medium, top + 112);
  nameOnLine(page, input.fromName, LEFT_X, top + 104, COL_W, display, medium);
  field(page, t.note, LEFT_X, top + 132, COL_W, medium, bottom);
  const note = printable(input.note ?? '', regular);
  if (note) {
    const size = 11.5;
    const [one, rest] = firstLine(note, regular, size, COL_W);
    page.drawText(fit(one, regular, size, COL_W, false).text, { x: LEFT_X, y: T(top + 164), size, font: regular, color: INK });
    if (rest) {
      const [two, more] = firstLine(rest, regular, size, COL_W);
      const last = more ? fit(`${two} ${more}`, regular, size, COL_W, false).text : two;
      page.drawText(last, { x: LEFT_X, y: T(top + 181), size, font: regular, color: INK });
    }
  }

  // Right: the value in the card's gold box, then the code, the date and the QR.
  spaced(page, t.value, RIGHT_X, T(top + 8), medium, LABEL_SIZE, 2.2, GOLD);
  const boxTop = top + 18;
  const boxH = 46;
  page.drawRectangle({ x: RIGHT_X, y: T(boxTop + boxH), width: COL_W, height: boxH, borderColor: LIGHT_GOLD, borderWidth: 0.8 });
  const euroSize = 18;
  page.drawText('€', { x: RIGHT_X + 14, y: T(boxTop + 31), size: euroSize, font: display, color: GOLD });
  const euroW = display.widthOfTextAtSize('€', euroSize);
  const value = fit(voucherAmountLabel(input.amountCents), display, 28, COL_W - 40 - euroW, true, 14);
  page.drawText(value.text, { x: RIGHT_X + 24 + euroW, y: T(boxTop + 33), size: value.size, font: display, color: INK });

  const qrSize = 76;
  const qrX = RIGHT_X + COL_W - qrSize;
  const textW = COL_W - qrSize - 12;
  field(page, t.code, RIGHT_X, top + 88, textW, medium, top + 132);
  const code = fit(input.code, medium, 17, textW, true, 9);
  page.drawText(code.text, { x: RIGHT_X, y: T(top + 124), size: code.size, font: medium, color: INK });
  field(page, t.validUntil, RIGHT_X, top + 152, textW, medium, bottom);
  page.drawText(voucherDateLabel(input.validUntil), { x: RIGHT_X, y: T(top + 192), size: 15, font: medium, color: INK });
  if (input.redeemUrl) drawQr(page, input.redeemUrl, qrX, T(bottom), qrSize);

  // The card's closing line under the same gold rule as the top.
  rule(page, T(BOTTOM_RULE), 160);
  centred(page, t.thanks[0], T(756), regular, 7, INK, W - 2 * MARGIN, 1.8);
  centred(page, t.thanks[1], T(768), regular, 7, INK, W - 2 * MARGIN, 1.8);

  // The two black logos, small, in the bottom corners over their handles.
  const handleY = 30;
  const logoBottom = handleY + 14;
  const tanninH = 48;
  const tanninW = (tannin.width / tannin.height) * tanninH;
  page.drawPage(tannin, { x: MARGIN, y: logoBottom, width: tanninW, height: tanninH });
  const cellarW = 112;
  const cellarH = (cellar.height / cellar.width) * cellarW;
  page.drawPage(cellar, { x: W - MARGIN - cellarW, y: logoBottom, width: cellarW, height: cellarH });

  const handleSize = 7;
  const tanninHandle = VENUE.instagram.toUpperCase();
  const cellarHandle = SHOP.instagram.toUpperCase();
  spaced(page, tanninHandle, MARGIN, handleY, regular, handleSize, 1.8, HANDLE);
  const cellarHandleW = regular.widthOfTextAtSize(cellarHandle, handleSize) + 1.8 * (cellarHandle.length - 1);
  spaced(page, cellarHandle, W - MARGIN - cellarHandleW, handleY, regular, handleSize, 1.8, HANDLE);

  return doc.save();
}
