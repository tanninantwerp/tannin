import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';

/** Drawing helpers both voucher layouts share. */

export const INK = rgb(0.1, 0.1, 0.1);
const MIN_SIZE = 7;

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

/**
 * Drops what the font cannot draw - emoji, mostly - rather than printing an
 * empty box on somebody's present. Work Sans covers every Latin script, so a
 * name is never touched; a heart in the note is.
 */
export function printable(text: string, font: PDFFont): string {
  const known = new Set(font.getCharacterSet());
  return Array.from(text.normalize('NFC'))
    .filter((ch) => ch === ' ' || known.has(ch.codePointAt(0)!))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the font has a glyph for every character, so nothing would be dropped. */
export function covers(text: string, font: PDFFont): boolean {
  const known = new Set(font.getCharacterSet());
  return Array.from(text.normalize('NFC')).every((ch) => ch === ' ' || known.has(ch.codePointAt(0)!));
}

/** Shrinks to fit, then cuts with an ellipsis if even the smallest size is too wide. */
export function fit(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
  shrink = true,
  minSize = MIN_SIZE,
): { text: string; size: number } {
  let s = size;
  while (shrink && s > minSize && font.widthOfTextAtSize(text, s) > width) s -= 0.5;
  if (font.widthOfTextAtSize(text, s) <= width) return { text, size: s };

  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, s) > width) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, size: s };
}

/** Breaks text between words into a first line that fits `width` and the rest. */
export function firstLine(text: string, font: PDFFont, size: number, width: number): [string, string] {
  const words = text.split(' ');
  let first = '';
  while (words.length > 0) {
    const next = first ? `${first} ${words[0]}` : words[0]!;
    if (font.widthOfTextAtSize(next, size) > width) break;
    first = next;
    words.shift();
  }
  // One word longer than the whole line: let `fit` cut it rather than loop.
  if (!first) return [words.shift() ?? '', words.join(' ')];
  return [first, words.join(' ')];
}

export function drawQr(page: PDFPage, url: string, x: number, y: number, size: number) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = size / n;
  page.drawRectangle({ x: x - 3, y: y - 3, width: size + 6, height: size + 6, color: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      // Row 0 is the top of the code; pdf-lib's y runs upwards.
      page.drawRectangle({ x: x + c * cell, y: y + size - (r + 1) * cell, width: cell, height: cell, color: INK });
    }
  }
}
