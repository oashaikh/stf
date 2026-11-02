import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { encryptToken } from '../../../server/src/lib/hmrcCrypto';
import type { HmrcStore } from '../hmrcStore';
import { confirmItsFinalForUser, itsFinalConfirmSchema, itsFinalSubmitSchema, previewItsFinalForUser, submitItsFinalForUser, type ItsFinalStore } from '../itsFinalDeclaration';
import type { TaxIdentifiersStore } from '../taxIdentifiers';
import type { TaxYearSummaryStore } from '../taxYearSummary';

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
      submittedAnnualBusinesses: async () => ['self-employment'],
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

describe('annual figures gate before the final declaration', () => {
  beforeEach(() => {
    vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
    vi.stubEnv('HMRC_ITSA_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  type Kind = 'self-employment' | 'uk-property';
  const setup = ({ businesses, submitted }: { businesses: Kind[]; submitted: Kind[] }) => {
    const submittedAnnualBusinesses = vi.fn(async () => submitted);
    const submissions: ItsFinalStore = {
      find: async () => undefined,
      submittedAnnualBusinesses,
      saveConfirmed: async () => true,
      claim: async () => true,
      markRejected: async () => undefined,
      recordReceipt: async () => undefined,
    };
    const hmrcStore = {
      sandboxMode: async () => true,
      credentials: async () => ({ vatNumber: null, accessToken: 'a', refreshToken: 'r', storedRefreshToken: 's', expiresAt: new Date('2099-01-01T00:00:00Z') }),
      status: async () => ({
        connected: true,
        expiresAt: null,
        itsBusinessId: businesses.includes('self-employment') ? 'XAIS12345678901' : null,
        itsPropertyBusinessId: businesses.includes('uk-property') ? 'XPIS12345678901' : null,
        needsItsReconnect: false,
      }),
      saveRefreshedTokens: async () => true,
    } as unknown as HmrcStore;
    const fetchFn = vi.fn(async (url: Parameters<typeof fetch>[0]) =>
      String(url).endsWith('/intent-to-finalise') ? Response.json({ calculationId: 'calc-1' }) : Response.json({
            calculation: { taxCalculation: { incomeTax: { incomeTaxCharged: 100.5 }, nics: { class4Nics: { totalClass4Charge: 20 } }, totalIncomeTaxAndNicsDue: 120.5 } },
          }),
    );
    const deps = {
      submissions,
      hmrcStore,
      identifiers: { get: async () => ({ ninoEncrypted: encryptToken('QQ123456C') }) } as unknown as TaxIdentifiersStore,
      summaryStore: { loadLines: async () => [], loadTrips: async () => [], loadChoice: async () => 'allowance' } as unknown as TaxYearSummaryStore,
      fetchFn,
    };
    return { deps, fetchFn, submittedAnnualBusinesses };
  };
  const preview = (deps: ReturnType<typeof setup>['deps']) =>
    previewItsFinalForUser({ userId: 'u1', taxYear: '2026-27', request: new Request('https://app.test') }, deps);

  it('lets the calculation run when both businesses have submitted', async () => {
    const { deps, fetchFn, submittedAnnualBusinesses } = setup({ businesses: ['self-employment', 'uk-property'], submitted: ['self-employment', 'uk-property'] });
    await expect(preview(deps)).resolves.toMatchObject({ calculationId: 'calc-1' });
    expect(fetchFn).toHaveBeenCalled();
    expect(submittedAnnualBusinesses).toHaveBeenCalledTimes(1);
    expect(submittedAnnualBusinesses).toHaveBeenCalledWith('u1', { taxYear: '2026-27', sandbox: true });
  });

  it('refuses before HMRC when the property figures are missing, naming the property business', async () => {
    const { deps, fetchFn } = setup({ businesses: ['self-employment', 'uk-property'], submitted: ['self-employment'] });
    await expect(preview(deps)).rejects.toMatchObject({ status: 409, code: 'ANNUAL_FIGURES_MISSING', message: expect.stringMatching(/property.*nothing has been sent.*Year end/is) });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses before HMRC when the self-employment figures are missing', async () => {
    const { deps, fetchFn } = setup({ businesses: ['self-employment', 'uk-property'], submitted: ['uk-property'] });
    await expect(preview(deps)).rejects.toMatchObject({ code: 'ANNUAL_FIGURES_MISSING', message: expect.stringMatching(/self-employment/i) });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('only asks about the one business a self-employment-only user has', async () => {
    const { deps } = setup({ businesses: ['self-employment'], submitted: ['self-employment'] });
    await expect(preview(deps)).resolves.toMatchObject({ calculationId: 'calc-1' });
  });

  it('handles a property-only user', async () => {
    const passing = setup({ businesses: ['uk-property'], submitted: ['uk-property'] });
    await expect(preview(passing.deps)).resolves.toMatchObject({ calculationId: 'calc-1' });
    const blocked = setup({ businesses: ['uk-property'], submitted: [] });
    await expect(preview(blocked.deps)).rejects.toMatchObject({ code: 'ANNUAL_FIGURES_MISSING', message: expect.stringMatching(/property/i) });
    expect(blocked.fetchFn).not.toHaveBeenCalled();
  });

  it('treats a pending or rejected row as missing because the store only reports submitted rows', async () => {
    // The store contract is "submitted only"; a store that returns nothing for those rows must block.
    const { deps, fetchFn } = setup({ businesses: ['self-employment'], submitted: [] });
    await expect(preview(deps)).rejects.toMatchObject({ code: 'ANNUAL_FIGURES_MISSING' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('repeats the check on confirm and submit', async () => {
    const { deps, fetchFn } = setup({ businesses: ['self-employment', 'uk-property'], submitted: ['self-employment'] });
    const request = new Request('https://app.test');
    await expect(confirmItsFinalForUser({ userId: 'u1', taxYear: '2026-27', calculationId: 'c', declaration: true, request }, deps)).rejects.toMatchObject({ code: 'ANNUAL_FIGURES_MISSING' });
    await expect(submitItsFinalForUser({ userId: 'u1', taxYear: '2026-27', request }, deps)).rejects.toMatchObject({ code: 'ANNUAL_FIGURES_MISSING' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
