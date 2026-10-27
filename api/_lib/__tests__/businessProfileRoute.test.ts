import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createBusinessProfileHandler } from '../../settings/business-profile';
import type { AuthDeps } from '../auth';
import { maskAccountNumber, maskProfileForAudit, type BusinessProfile, type BusinessProfileStore } from '../businessProfile';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const valid: BusinessProfile = {
  businessName: 'Test Plumbing',
  businessAddress: '1 Example Street\nTestville',
  paymentBankName: 'Example Bank',
  paymentSortCode: '112233',
  paymentAccountNumber: '12345678',
  invoicePrefix: 'INV-',
  nextInvoiceNumber: 1,
};

describe('maskAccountNumber', () => {
  it('keeps only the last 4 digits and passes null through', () => {
    expect(maskAccountNumber('12345678')).toBe('••••5678');
    expect(maskAccountNumber(null)).toBeNull();
    expect(maskProfileForAudit(valid).paymentAccountNumber).toBe('••••5678');
  });
});

describe('business-profile route', () => {
  let profiles: Record<string, BusinessProfile>;
  const store: BusinessProfileStore = {
    get: async (userId) => profiles[userId],
    update: async (userId, profile) => (userId in profiles ? (profiles[userId] = profile) : undefined),
  };
  const call = (method: string, body?: unknown, userId?: string, query = '') =>
    createBusinessProfileHandler(store, authDeps)(
      new Request(`https://app.test/api/settings/business-profile${query}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: userId ? { cookie: `stf_session=tok-${userId}` } : {},
      }),
    );
  const reset = () => {
    profiles = { u1: { ...valid, paymentAccountNumber: null, paymentSortCode: null }, u2: { ...valid, businessName: 'Other' } };
  };

  it('requires sign-in', async () => {
    reset();
    expect((await call('GET')).status).toBe(401);
    expect((await call('PUT', valid)).status).toBe(401);
  });

  it('saves and returns the caller profile, and ignores a client-supplied id', async () => {
    reset();
    const response = await call('PUT', { ...valid, userId: 'u2' }, 'u1', '?userId=u2');
    expect(response.status).toBe(200);
    expect((await response.json()).profile.paymentAccountNumber).toBe('12345678');
    expect(profiles.u1).toEqual(valid);
    expect(profiles.u2.businessName).toBe('Other');
  });

  it('reads only the caller profile', async () => {
    reset();
    expect((await (await call('GET', undefined, 'u2')).json()).profile.businessName).toBe('Other');
  });

  it.each([
    ['five-digit sort code', { paymentSortCode: '11223' }],
    ['dashed sort code', { paymentSortCode: '11-22-33' }],
    ['seven-digit account number', { paymentAccountNumber: '1234567' }],
    ['lettered account number', { paymentAccountNumber: '1234567A' }],
    ['empty prefix', { invoicePrefix: '' }],
    ['zero next number', { nextInvoiceNumber: 0 }],
    ['fractional next number', { nextInvoiceNumber: 1.5 }],
  ])('refuses %s with 400 and saves nothing', async (_label, change) => {
    reset();
    const before = profiles.u1;
    expect((await call('PUT', { ...valid, ...change }, 'u1')).status).toBe(400);
    expect(profiles.u1).toBe(before);
  });

  it('stores blank optional fields as null', async () => {
    reset();
    await call('PUT', { ...valid, businessAddress: ' ', paymentSortCode: '', paymentAccountNumber: '' }, 'u1');
    expect(profiles.u1).toMatchObject({ businessAddress: null, paymentSortCode: null, paymentAccountNumber: null });
  });

  it('answers 404 when the user row is missing and 405 for other methods', async () => {
    reset();
    expect((await call('PUT', valid, 'ghost')).status).toBe(404);
    expect((await call('DELETE', undefined, 'u1')).status).toBe(405);
  });
});
