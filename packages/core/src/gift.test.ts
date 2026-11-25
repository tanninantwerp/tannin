import { describe, expect, it } from 'vitest';
import {
  GIFT_FIELD_LIMITS,
  GIFT_MAX_EUROS,
  GIFT_MIN_EUROS,
  GIFT_PRESETS,
  VOUCHER_CODE_FIRST,
  normaliseVoucherCode,
  parseEuroInput,
  validateGiftOrder,
  voucherAmountLabel,
  voucherDateLabel,
} from './gift';

const GOOD = {
  amountEuros: 50,
  recipientName: 'Marieke',
  fromName: 'Jan',
  note: 'Happy birthday',
  buyerEmail: 'jan@example.com',
};

describe('validateGiftOrder', () => {
  it('accepts a complete order', () => {
    expect(validateGiftOrder(GOOD)).toEqual({});
  });

  it('accepts every preset', () => {
    for (const amountEuros of GIFT_PRESETS) expect(validateGiftOrder({ ...GOOD, amountEuros })).toEqual({});
  });

  it('needs an amount, in whole euros, inside the range', () => {
    expect(validateGiftOrder({ ...GOOD, amountEuros: undefined }).amountEuros).toBe('amount');
    expect(validateGiftOrder({ ...GOOD, amountEuros: Number.NaN }).amountEuros).toBe('amount');
    expect(validateGiftOrder({ ...GOOD, amountEuros: GIFT_MIN_EUROS - 1 }).amountEuros).toBe('amountRange');
    expect(validateGiftOrder({ ...GOOD, amountEuros: GIFT_MAX_EUROS + 1 }).amountEuros).toBe('amountRange');
    expect(validateGiftOrder({ ...GOOD, amountEuros: 37.5 }).amountEuros).toBe('amountRange');
  });

  it('needs who it is for and who it is from', () => {
    const errors = validateGiftOrder({ ...GOOD, recipientName: '  ', fromName: '' });
    expect(errors.recipientName).toBe('recipientName');
    expect(errors.fromName).toBe('fromName');
  });

  it('leaves the note optional but caps it at what fits on the card', () => {
    expect(validateGiftOrder({ ...GOOD, note: '' })).toEqual({});
    expect(validateGiftOrder({ ...GOOD, note: 'x'.repeat(GIFT_FIELD_LIMITS.note + 1) }).note).toBe('noteTooLong');
  });

  it('needs an email that looks like one', () => {
    expect(validateGiftOrder({ ...GOOD, buyerEmail: '' }).buyerEmail).toBe('buyerEmail');
    expect(validateGiftOrder({ ...GOOD, buyerEmail: 'jan@' }).buyerEmail).toBe('emailInvalid');
  });

  it('needs an address for the recipient only when the voucher goes to them', () => {
    expect(validateGiftOrder({ ...GOOD, recipientEmail: '' })).toEqual({});
    expect(validateGiftOrder({ ...GOOD, sendToRecipient: true, recipientEmail: '' }).recipientEmail).toBe(
      'recipientEmail',
    );
    expect(
      validateGiftOrder({ ...GOOD, sendToRecipient: true, recipientEmail: 'marieke@' }).recipientEmail,
    ).toBe('recipientEmailInvalid');
    expect(validateGiftOrder({ ...GOOD, sendToRecipient: true, recipientEmail: 'm@example.com' })).toEqual({});
  });
});

describe('normaliseVoucherCode', () => {
  it('finds the five-digit code however it was typed', () => {
    expect(normaliseVoucherCode('10023')).toBe('10023');
    expect(normaliseVoucherCode(' 10 023 ')).toBe('10023');
    expect(normaliseVoucherCode('tn10023')).toBe('10023');
  });

  it('starts the numbers at 10000', () => {
    expect(VOUCHER_CODE_FIRST).toBe(10000);
  });

  it('refuses anything that cannot be a code', () => {
    expect(normaliseVoucherCode('')).toBeNull();
    expect(normaliseVoucherCode('1002')).toBeNull();
    expect(normaliseVoucherCode('100234')).toBeNull();
    expect(normaliseVoucherCode('TN-7KQ4-M9XD')).toBeNull();
  });
});

describe('labels', () => {
  it('prints whole euros without decimals and the rest with a comma', () => {
    expect(voucherAmountLabel(5000)).toBe('50');
    expect(voucherAmountLabel(5050)).toBe('50,50');
    expect(voucherAmountLabel(5005)).toBe('50,05');
  });

  it('writes dates the Belgian way', () => {
    expect(voucherDateLabel('2027-10-28')).toBe('28/10/2027');
  });
});

describe('parseEuroInput', () => {
  it('reads an amount however it was typed at the till', () => {
    expect(parseEuroInput('12')).toBe(1200);
    expect(parseEuroInput('12,50')).toBe(1250);
    expect(parseEuroInput('12.5')).toBe(1250);
    expect(parseEuroInput('€ 12,05')).toBe(1205);
  });

  it('refuses what is not a positive amount', () => {
    expect(parseEuroInput('')).toBeNull();
    expect(parseEuroInput('0')).toBeNull();
    expect(parseEuroInput('-5')).toBeNull();
    expect(parseEuroInput('12,505')).toBeNull();
    expect(parseEuroInput('twelve')).toBeNull();
  });
});
