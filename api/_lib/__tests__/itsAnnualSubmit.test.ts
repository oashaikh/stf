import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { encryptToken } from '../../../server/src/lib/hmrcCrypto';
import type { TaxYearLine } from '../../../src/lib/taxYearSummary';
import type { HmrcStore } from '../hmrcStore';
import { confirmItsAnnualForUser, previewItsAnnualForUser, submitItsAnnualForUser, type ItsAnnualDeps, type ItsAnnualStore } from '../itsAnnualSubmit';
import type { TaxIdentifiersStore } from '../taxIdentifiers';
import type { TaxYearSummaryStore } from '../taxYearSummary';

const NINO = 'QQ123456C';
const BUSINESS_ID = 'XAIS12345678901';
const PROPERTY_BUSINESS_ID = 'XPIS12345678901';
const taxYear = '2026-27';
const request = new Request('https://app.test/api/hmrc/its-annual-submit', { method: 'POST' });

const incomeLine: TaxYearLine = {
  date: '2026-07-10',
  accountId: 'sales',
  accountName: 'Sales',
  accountType: 'income',
  taxCategory: 'turnover',
  amountPence: -100000,
  vatPence: 0,
  status: 'confirmed',
  deletedAt: null,
};

const rentLine: TaxYearLine = { ...incomeLine, accountId: 'rent', accountName: 'Rent', taxCategory: 'property-rent-received', amountPence: -500000 };

function fakeDeps(options: { userSandbox?: boolean; choice?: 'actual' | 'allowance'; httpStatus?: number } = {}) {
  type Row = { id: string; userId: string; status: 'confirmed' | 'pending' | 'submitted' | 'rejected'; payload: unknown };
  const rows = new Map<string, Row>();
  const audits: Array<{ action: string; snapshot: unknown }> = [];
  const key = (userId: string, period: { taxYear: string; sandbox: boolean; businessKind?: string }) => `${userId}:${period.taxYear}:${period.sandbox}:${period.businessKind ?? 'self-employment'}`;
  const submissions: ItsAnnualStore = {
    find: async (userId, period) => {
      const row = rows.get(key(userId, period));
      return row && { id: row.id, status: row.status, confirmedPayload: row.payload };
    },
    saveConfirmed: async (userId, period, payload, _now, audit) => {
      const existing = rows.get(key(userId, period));
      if (existing && (existing.status === 'pending' || existing.status === 'submitted')) return false;
      rows.set(key(userId, period), { id: key(userId, period), userId, status: 'confirmed', payload });
      audits.push({ action: 'its_annual.confirmed', snapshot: audit });
      return true;
    },
    claim: async (userId, id) => {
      const row = rows.get(id);
      if (!row || row.userId !== userId || row.status !== 'confirmed') return false;
      row.status = 'pending';
      return true;
    },
    markRejected: async (_userId, id, audit) => {
      rows.get(id)!.status = 'rejected';
      audits.push({ action: 'its_annual.rejected', snapshot: audit });
    },
    recordReceipt: async (_userId, id, _now, audit) => {
      rows.get(id)!.status = 'submitted';
      audits.push({ action: 'its_annual.submitted', snapshot: audit });
    },
  };
  const hmrcStore = {
    sandboxMode: async () => options.userSandbox ?? true,
    credentials: async () => ({
      vatNumber: null,
      accessToken: 'access-secret-token',
      refreshToken: 'refresh-secret',
      storedRefreshToken: 'stored',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    }),
    status: async () => ({ connected: true, expiresAt: null, itsBusinessId: BUSINESS_ID, itsPropertyBusinessId: PROPERTY_BUSINESS_ID, needsItsReconnect: false }),
    saveRefreshedTokens: async () => true,
  } as unknown as HmrcStore;
  const summaryStore: TaxYearSummaryStore = {
    loadLines: async () => [incomeLine, rentLine],
    loadTrips: async () => [],
    loadChoice: async () => options.choice,
  };
  const fetchFn = vi.fn(async (..._args: Parameters<typeof fetch>) =>
    options.httpStatus && options.httpStatus >= 400
      ? new Response(JSON.stringify({ code: 'RULE_X', message: 'no' }), { status: options.httpStatus })
      : new Response(null, { status: 204 }),
  );
  const deps: ItsAnnualDeps = {
    submissions,
    hmrcStore,
    identifiers: { get: async () => ({ ninoEncrypted: encryptToken(NINO) }) } as unknown as TaxIdentifiersStore,
    summaryStore,
    fetchFn,
    recordPreview: async () => undefined,
  };
  return { deps, fetchFn, rows, audits };
}

beforeEach(() => {
  vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  vi.stubEnv('HMRC_ITSA_ENABLED', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const confirm = (deps: ItsAnnualDeps, userId = 'u1') => confirmItsAnnualForUser({ userId, taxYear, declaration: true, request }, deps);
const submit = (deps: ItsAnnualDeps, userId = 'u1') => submitItsAnnualForUser({ userId, taxYear, request }, deps);

describe('annual submission gates', () => {
  it('refuses everything when Income Tax is off', async () => {
    vi.stubEnv('HMRC_ITSA_ENABLED', 'false');
    const { deps, fetchFn } = fakeDeps();
    await expect(previewItsAnnualForUser({ userId: 'u1', taxYear }, deps)).rejects.toMatchObject({ code: 'ITSA_DISABLED' });
    await expect(confirm(deps)).rejects.toMatchObject({ code: 'ITSA_DISABLED' });
    await expect(submit(deps)).rejects.toMatchObject({ code: 'ITSA_DISABLED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses live mode unless the deployment and the user both opted in', async () => {
    vi.stubEnv('HMRC_SANDBOX_MODE', 'false');
    const { deps, fetchFn } = fakeDeps({ userSandbox: true });
    await expect(submit(deps)).rejects.toMatchObject({ code: 'LIVE_MODE_REFUSED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses confirm without the declaration', async () => {
    const { deps } = fakeDeps();
    await expect(confirmItsAnnualForUser({ userId: 'u1', taxYear, declaration: false, request }, deps)).rejects.toMatchObject({ code: 'DECLARATION_REQUIRED' });
  });
});

describe('annual submission claim and receipt', () => {
  it('refuses to submit with no stored confirmation', async () => {
    const { deps, fetchFn } = fakeDeps();
    await expect(submit(deps)).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends the stored snapshot and writes confirm and submit audit rows', async () => {
    const { deps, fetchFn, audits } = fakeDeps({ choice: 'allowance' });
    await confirm(deps);
    await submit(deps);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain(`/annual/${taxYear}`);
    expect(JSON.parse(String(init!.body))).toEqual({ allowances: { tradingIncomeAllowance: '1000.00' } });
    expect(audits.map((audit) => audit.action)).toEqual(['its_annual.confirmed', 'its_annual.submitted']);
  });

  it('refuses a second submit once the first has been filed', async () => {
    const { deps, fetchFn } = fakeDeps();
    await confirm(deps);
    await submit(deps);
    await expect(submit(deps)).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('lets only one of two concurrent submits through', async () => {
    const { deps, fetchFn } = fakeDeps();
    await confirm(deps);
    const results = await Promise.allSettled([submit(deps), submit(deps)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses a stale confirmation when the choice changed since', async () => {
    const { deps } = fakeDeps({ choice: 'allowance' });
    await confirm(deps);
    const changed = { ...deps, summaryStore: { ...deps.summaryStore!, loadChoice: async () => 'actual' as const } };
    await expect(submit(changed)).rejects.toMatchObject({ code: 'STALE_CONFIRMATION' });
  });

  it('records a 4xx as a rejection and then needs a fresh confirmation', async () => {
    const { deps, audits, fetchFn } = fakeDeps({ httpStatus: 422 });
    await confirm(deps);
    await expect(submit(deps)).rejects.toMatchObject({ code: 'RULE_X' });
    expect(audits.map((audit) => audit.action)).toContain('its_annual.rejected');
    await expect(submit(deps)).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps the claim pending when HMRC fails with a 5xx', async () => {
    const { deps, rows } = fakeDeps({ httpStatus: 503 });
    await confirm(deps);
    await expect(submit(deps)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect([...rows.values()][0]!.status).toBe('pending');
  });
});

describe('uk-property annual submission', () => {
  const property = { taxYear, business: 'uk-property' as const, choice: 'allowance' as const };
  const confirmProperty = (deps: ItsAnnualDeps, userId = 'u1', choice: 'allowance' | 'actual' = 'allowance') =>
    confirmItsAnnualForUser({ userId, ...property, choice, declaration: true, request }, deps);
  const submitProperty = (deps: ItsAnnualDeps, userId = 'u1') => submitItsAnnualForUser({ userId, ...property, request }, deps);

  it('previews the masked property endpoint and body without calling HMRC', async () => {
    const { deps, fetchFn } = fakeDeps();
    const preview = await previewItsAnnualForUser({ userId: 'u1', ...property }, deps);
    expect(preview.endpoint.url).toContain('/individuals/business/property/uk/');
    expect(preview.endpoint.url).toContain(`/annual/${taxYear}`);
    expect(preview.endpoint.url).not.toContain(NINO);
    expect(preview.endpoint.url).not.toContain(PROPERTY_BUSINESS_ID);
    expect(preview.body).toEqual({ ukProperty: { allowances: { propertyIncomeAllowance: 1000 } } });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends the stored property body to the property endpoint with the property id', async () => {
    const { deps, fetchFn } = fakeDeps();
    await confirmProperty(deps);
    await submitProperty(deps);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain(`/property/uk/${NINO}/${PROPERTY_BUSINESS_ID}/annual/${taxYear}`);
    expect(JSON.parse(String(init!.body))).toEqual({ ukProperty: { allowances: { propertyIncomeAllowance: 1000 } } });
  });

  it('keeps property and self-employment confirmations apart', async () => {
    const { deps, fetchFn } = fakeDeps();
    await confirm(deps);
    await expect(submitProperty(deps)).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses another user the first user\'s confirmed year', async () => {
    const { deps, fetchFn } = fakeDeps();
    await confirmProperty(deps, 'u1');
    await expect(submitProperty(deps, 'u2')).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses live mode when the user has not opted in', async () => {
    vi.stubEnv('HMRC_SANDBOX_MODE', 'false');
    const { deps, fetchFn } = fakeDeps({ userSandbox: true });
    await expect(submitProperty(deps)).rejects.toMatchObject({ code: 'LIVE_MODE_REFUSED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a second submit and lets one of two concurrent submits through', async () => {
    const { deps, fetchFn } = fakeDeps();
    await confirmProperty(deps);
    const results = await Promise.allSettled([submitProperty(deps), submitProperty(deps)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(submitProperty(deps)).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('releases the lock on a 4xx and leaves it pending on a 5xx', async () => {
    const rejected = fakeDeps({ httpStatus: 422 });
    await confirmProperty(rejected.deps);
    await expect(submitProperty(rejected.deps)).rejects.toMatchObject({ code: 'RULE_X' });
    await expect(submitProperty(rejected.deps)).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });

    const unknown = fakeDeps({ httpStatus: 503 });
    await confirmProperty(unknown.deps);
    await expect(submitProperty(unknown.deps)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect([...unknown.rows.values()][0]!.status).toBe('pending');
  });

  it('refuses a confirmation made with a different choice', async () => {
    const { deps } = fakeDeps();
    await confirmProperty(deps, 'u1', 'actual');
    await expect(submitProperty(deps)).rejects.toMatchObject({ code: 'STALE_CONFIRMATION' });
  });

  it('refuses property confirm without the declaration', async () => {
    const { deps } = fakeDeps();
    await expect(confirmItsAnnualForUser({ userId: 'u1', ...property, declaration: false, request }, deps)).rejects.toMatchObject({ code: 'DECLARATION_REQUIRED' });
  });
});
