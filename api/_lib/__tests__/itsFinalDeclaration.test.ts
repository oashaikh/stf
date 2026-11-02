import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { encryptToken } from '../../../server/src/lib/hmrcCrypto';
import type { HmrcStore } from '../hmrcStore';
import { confirmItsFinalForUser, itsFinalConfirmSchema, itsFinalSubmitSchema, submitItsFinalForUser, type ItsFinalStore } from '../itsFinalDeclaration';
import type { TaxIdentifiersStore } from '../taxIdentifiers';

describe('final declaration input schemas', () => {
  const valid = { taxYear: '2026-27', calculationId: 'abc-123', declaration: true };

  it('accepts the tick with a calculation id', () => {
    expect(itsFinalConfirmSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['no tick', { ...valid, declaration: undefined }],
    ['an unticked box', { ...valid, declaration: false }],
    ['a calculation id with path characters', { ...valid, calculationId: '../x' }],
    ['an empty calculation id', { ...valid, calculationId: '' }],
  ])('refuses %s', (_label, body) => {
    expect(itsFinalConfirmSchema.safeParse(body).success).toBe(false);
  });

  it('submit needs confirm true and nothing else', () => {
    expect(itsFinalSubmitSchema.safeParse({ taxYear: '2026-27', confirm: true }).success).toBe(true);
    expect(itsFinalSubmitSchema.safeParse({ taxYear: '2026-27', confirm: true, calculationId: 'x' }).success).toBe(false);
  });
});

describe('confirmItsFinalForUser', () => {
  it('refuses without the declaration before reading anything', async () => {
    await expect(
      confirmItsFinalForUser({ userId: 'u1', taxYear: '2026-27', calculationId: 'c', declaration: false, request: new Request('https://app.test') }),
    ).rejects.toMatchObject({ status: 400, code: 'DECLARATION_REQUIRED' });
  });
});

describe('submitItsFinalForUser', () => {
  beforeEach(() => {
    vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
    vi.stubEnv('HMRC_ITSA_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('releases the claim when the token refresh fails before anything reaches HMRC', async () => {
    let status = 'confirmed';
    const submissions: ItsFinalStore = {
      find: async () => ({ id: 'row', status: status as 'confirmed', calculationId: 'calc-1' }),
      saveConfirmed: async () => true,
      claim: async () => {
        status = 'pending';
        return true;
      },
      markRejected: async () => {
        status = 'rejected';
      },
      recordReceipt: async () => undefined,
    };
    const hmrcStore = {
      sandboxMode: async () => true,
      credentials: async () => ({ vatNumber: null, accessToken: 'a', refreshToken: 'r', storedRefreshToken: 's', expiresAt: new Date('2000-01-01T00:00:00Z') }),
      status: async () => ({ connected: true, expiresAt: null, itsBusinessId: 'XAIS12345678901', needsItsReconnect: false }),
      saveRefreshedTokens: async () => true,
    } as unknown as HmrcStore;
    const fetchFn = vi.fn();
    await expect(
      submitItsFinalForUser(
        { userId: 'u1', taxYear: '2026-27', request: new Request('https://app.test') },
        {
          submissions,
          hmrcStore,
          identifiers: { get: async () => ({ ninoEncrypted: encryptToken('QQ123456C') }) } as unknown as TaxIdentifiersStore,
          fetchFn,
          refresh: async () => {
            throw new TypeError('network down');
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'HMRC_UNAVAILABLE' });
    expect(status).toBe('rejected');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
