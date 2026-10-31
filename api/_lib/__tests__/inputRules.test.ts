import { describe, expect, it } from 'vitest';

import { businessProfileSchema } from '../businessProfile.js';
import { validateAccountName } from '../accounts.js';
import { newEntrySchema } from '../entries.js';
import { hasControlCharacters, plainText } from '../inputRules.js';
import { validateNewTrip } from '../mileage.js';

describe('hasControlCharacters', () => {
  it('flags NUL, escape, DEL and line breaks unless multiline allows newline and tab', () => {
    expect(hasControlCharacters('a\u0000b')).toBe(true);
    expect(hasControlCharacters('a\u001bb')).toBe(true);
    expect(hasControlCharacters('a\u007fb')).toBe(true);
    expect(hasControlCharacters('a\nb')).toBe(true);
    expect(hasControlCharacters('a\nb\tc', { multiline: true })).toBe(false);
    expect(hasControlCharacters('a\u0000b', { multiline: true })).toBe(true);
    expect(hasControlCharacters('plain £ text <b>')).toBe(false);
  });
});

describe('plainText', () => {
  it('trims, bounds length and rejects control characters with a readable message', () => {
    const schema = plainText(5);
    expect(schema.parse('  abc ')).toBe('abc');
    expect(schema.safeParse('abcdef').success).toBe(false);
    const result = schema.safeParse('a\u0000b');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('control characters');
  });
});

describe('shared schemas use it', () => {
  const entry = { date: '2026-01-01', description: 'ok', categoryAccountId: '11111111-1111-4111-8111-111111111111', amountPence: 100, type: 'expense', paymentAccountId: '11111111-1111-4111-8111-111111111111' };
  it('rejects control characters in an entry description', () => {
    expect(newEntrySchema.safeParse({ ...entry, description: 'bad\u0000' }).success).toBe(false);
  });
  it('allows a newline in a business address but not a NUL', () => {
    const profile = { businessName: null, businessAddress: 'a\nb', paymentBankName: null, paymentSortCode: null, paymentAccountNumber: null, invoicePrefix: 'INV', nextInvoiceNumber: 1 };
    expect(businessProfileSchema.safeParse(profile).success).toBe(true);
    expect(businessProfileSchema.safeParse({ ...profile, businessAddress: 'a\u0000b' }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...profile, invoicePrefix: 'I\nV' }).success).toBe(false);
  });
});

describe('hand validators', () => {
  it('reject control characters', () => {
    expect(validateAccountName('Bank\u0000')).toBeNull();
    expect(validateAccountName('Bank')).toBe('Bank');
    expect(validateNewTrip({ date: '2026-01-01', from: 'A\u0007', to: 'B', purpose: 'x', distanceTenths: 10, vehicleType: 'car' })).toBeNull();
  });
});

describe('HMRC identifiers', () => {
  it('limits a period key to letters, digits, # and dashes, and dates to real days', async () => {
    const { periodSchema } = await import('../vatReturns.js');
    const period = { periodKey: '24A1', start: '2026-01-01', end: '2026-03-31' };
    expect(periodSchema.safeParse(period).success).toBe(true);
    expect(periodSchema.safeParse({ ...period, periodKey: "24A1'; DROP" }).success).toBe(false);
    expect(periodSchema.safeParse({ ...period, start: '2026-02-30' }).success).toBe(false);
  });
});
