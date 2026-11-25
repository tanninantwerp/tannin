import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { renderOnlineVoucherPdf } from './online';

describe('renderOnlineVoucherPdf', () => {
  it('is one portrait A4 page', async () => {
    const bytes = await renderOnlineVoucherPdf({
      code: 'TN-7KQ4-M9XD',
      amountCents: 5000,
      validUntil: '2027-10-28',
      recipientName: 'Marieke',
      fromName: 'Jan',
      note: 'Happy birthday - drink something orange on me.',
      redeemUrl: 'https://admin.ta-nnin.be/vouchers?code=TN-7KQ4-M9XD',
      locale: 'nl',
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    expect(doc.getTitle()).toBe('Gift voucher TN-7KQ4-M9XD');
  });

  it('copes with any name, an overlong note, the odd emoji and nothing at all', async () => {
    const full = await renderOnlineVoucherPdf({
      code: 'TN-7KQ4-M9XD',
      amountCents: 100000,
      validUntil: '2027-10-28',
      recipientName: 'Łukasz Żółć-Brzęczyszczykiewicz and the rest of the family',
      fromName: 'Şükrü & Zoë 🍷',
      note: 'word '.repeat(80),
    });
    expect(full.byteLength).toBeGreaterThan(10_000);
    const bare = await renderOnlineVoucherPdf({ code: 'TN-7KQ4-M9XD', amountCents: 2500, validUntil: '2027-10-28' });
    expect(bare.byteLength).toBeGreaterThan(10_000);
  });
});
