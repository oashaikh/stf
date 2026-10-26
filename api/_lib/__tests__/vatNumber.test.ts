import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createVatNumberHandler } from '../../settings/vat-number';
import type { AuthDeps } from '../auth';
import { maskVatNumber, normaliseVatNumber, type VatNumberStore } from '../vatNumber';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

describe('normaliseVatNumber', () => {
  it.each([
    ['123456789', '123456789'],
    ['GB123456789', '123456789'],
    ['gb 123 456 789', '123456789'],
    [' 123 4567 89 ', '123456789'],
  ])('accepts %j as 9 digits', (input, expected) => {
    expect(normaliseVatNumber(input)).toBe(expected);
  });

  it.each(['12345678', '1234567890', '12345678A', 'ABC123456789', 'GBGB123456789', '', 42, null])(
    'refuses %j',
    (input) => {
      expect(normaliseVatNumber(input)).toBeNull();
    },
  );
});

it('masks all but the last 3 digits', () => {
  expect(maskVatNumber('123456789')).toBe('••••••789');
});

describe('vat-number route', () => {
  let vat: Record<string, string | null>;
  let livePending: Record<string, boolean>;
  const store: VatNumberStore = {
    get: async (userId) => vat[userId],
    set: async (userId, vatNumber) => {
      vat[userId] = vatNumber;
    },
    hasPendingLiveSubmission: async (userId) => livePending[userId] === true,
  };
  const call = (method: string, body?: unknown, userId?: string) =>
    createVatNumberHandler(store, authDeps)(
      new Request('https://app.test/api/settings/vat-number', {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: userId ? { cookie: `stf_session=tok-${userId}` } : {},
      }),
    );

  const reset = () => {
    vat = { u1: null, u2: '999999999' };
    livePending = {};
  };

  it('requires sign-in for GET and POST', async () => {
    reset();
    expect((await call('GET')).status).toBe(401);
    expect((await call('POST', { vatNumber: '123456789' })).status).toBe(401);
  });

  it('returns no number, then only the masked one', async () => {
    reset();
    expect(await (await call('GET', undefined, 'u1')).json()).toMatchObject({ ok: true, masked: null });
    await call('POST', { vatNumber: 'GB 123 456 789' }, 'u1');
    const body = await (await call('GET', undefined, 'u1')).json();
    expect(body.masked).toBe('••••••789');
    expect(JSON.stringify(body)).not.toContain('123456');
  });

  it('saves 9 digits for the caller only', async () => {
    reset();
    const response = await call('POST', { vatNumber: 'GB 123 456 789' }, 'u1');
    expect(response.status).toBe(200);
    expect(vat.u1).toBe('123456789');
    expect(vat.u2).toBe('999999999');
  });

  it.each(['12345678', '1234567890', '12345678A'])('refuses %j with 400 and saves nothing', async (value) => {
    reset();
    expect((await call('POST', { vatNumber: value }, 'u1')).status).toBe(400);
    expect(vat.u1).toBeNull();
  });

  it('refuses a change while a live submission is pending, but not another user’s', async () => {
    reset();
    livePending = { u1: true };
    const response = await call('POST', { vatNumber: '123456789' }, 'u1');
    expect(response.status).toBe(409);
    expect(vat.u1).toBeNull();
    expect((await call('POST', { vatNumber: '123456789' }, 'u2')).status).toBe(200);
  });

  it('refuses other methods', async () => {
    reset();
    expect((await call('DELETE', undefined, 'u1')).status).toBe(405);
  });
});
