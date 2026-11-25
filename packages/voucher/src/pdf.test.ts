import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { renderVoucherPdf } from './pdf';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('renderVoucherPdf', () => {
  it('fills in the two-page card', async () => {
    const bytes = await renderVoucherPdf({
      code: 'TN-7KQ4-M9XD',
      amountCents: 5000,
      validUntil: '2027-10-28',
      recipientName: 'Marieke',
      fromName: 'Jan',
      note: 'Happy birthday - drink something orange on me.',
      redeemUrl: 'https://admin.ta-nnin.be/vouchers?code=TN-7KQ4-M9XD',
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getTitle()).toBe('Gift voucher TN-7KQ4-M9XD');
  });

  it('copes with any name, an overlong note and the odd emoji', async () => {
    const bytes = await renderVoucherPdf({
      code: 'TN-7KQ4-M9XD',
      amountCents: 12550,
      validUntil: '2027-10-28',
      recipientName: 'Łukasz Żółć-Brzęczyszczykiewicz and the rest of the family',
      fromName: 'Şükrü & Zoë 🍷',
      note: 'word '.repeat(80),
    });
    expect(bytes.byteLength).toBeGreaterThan(10_000);
  });

  it('is generated from the committed assets', () => {
    // Same idea as setup.sql: the base64 copy is generated, so the risk is
    // that it is stale, not that it is wrong.
    const file = join(HERE, 'assets.generated.ts');
    const before = readFileSync(file, 'utf8');
    execFileSync(process.execPath, [join(HERE, '../../../scripts/embed-voucher-assets.mjs')], { stdio: 'ignore' });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});
