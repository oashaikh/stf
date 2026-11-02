import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { encryptToken } from '../../../server/src/lib/hmrcCrypto';
import type { TaxYearLine } from '../../../src/lib/taxYearSummary';
import type { HmrcCredentials, HmrcStore } from '../hmrcStore';
import { confirmItsUpdateForUser, submitItsUpdateForUser, type ItsSubmissionStore, type ItsSubmitDeps } from '../itsSubmit';
import type { TaxIdentifiersStore } from '../taxIdentifiers';
import type { TaxYearSummaryStore } from '../taxYearSummary';
import { VatReturnError } from '../vatReturns';

const NINO = 'QQ123456C';
const BUSINESS_ID = 'XAIS12345678901';
const PROPERTY_BUSINESS_ID = 'XPIS12345678901';
const ACCESS = 'access-secret-token';
const NOW = new Date('2026-10-26T10:00:00Z');
const target = { taxYear: '2026-27', quarter: 2 as const };

const incomeLine = (amountPence: number): TaxYearLine => ({
  date: '2026-07-10',
  accountId: 'sales',
  accountName: 'Sales',
  accountType: 'income',
  taxCategory: 'turnover',
  amountPence,
  vatPence: 0,
  status: 'confirmed',
  deletedAt: null,
});

const rentLine = (amountPence: number): TaxYearLine => ({
  ...incomeLine(amountPence),
  accountId: 'rent',
  accountName: 'Rent received',
  taxCategory: 'property-rent-received',
});

interface Row {
  id: string;
  userId: string;
  status: 'confirmed' | 'pending' | 'submitted' | 'rejected';
  payload: unknown;
}

function setup(over: { sandboxOptIn?: boolean } = {}) {
  const ledger: Record<string, TaxYearLine[]> = { user_a: [incomeLine(-100000), rentLine(-80000)], user_b: [incomeLine(-5000)] };
  const rows = new Map<string, Row>();
  const audits: Array<{ action: string; snapshot: unknown }> = [];
  const key = (userId: string, taxYear: string, quarter: number, sandbox: boolean, kind = 'self-employment') =>
    `${userId}:${taxYear}:${quarter}:${sandbox}:${kind}`;

  const submissions: ItsSubmissionStore = {
    find: async (userId, period) => {
      const row = rows.get(key(userId, period.taxYear, period.quarter, period.sandbox, period.kind));
      return row && { id: row.id, status: row.status, confirmedPayload: row.payload };
    },
    saveConfirmed: async (userId, period, payload, _now, audit) => {
      const k = key(userId, period.taxYear, period.quarter, period.sandbox, period.kind);
      const existing = rows.get(k);
      if (existing && (existing.status === 'pending' || existing.status === 'submitted')) return false;
      rows.set(k, { id: k, userId, status: 'confirmed', payload });
      audits.push({ action: 'its_update.confirmed', snapshot: audit });
      return true;
    },
    claim: async (userId, id) => {
      const row = rows.get(id);
      if (!row || row.userId !== userId || row.status !== 'confirmed') return false;
      row.status = 'pending';
      return true;
    },
    markRejected: async (userId, id, audit) => {
      const row = rows.get(id);
      if (!row || row.userId !== userId || row.status !== 'pending') throw new Error('not pending');
      row.status = 'rejected';
      audits.push({ action: 'its_update.rejected', snapshot: audit });
    },
    recordReceipt: async (userId, id, _now, audit) => {
      const row = rows.get(id);
      if (!row || row.userId !== userId || row.status !== 'pending') throw new Error('not pending');
      row.status = 'submitted';
      audits.push({ action: 'its_update.submitted', snapshot: audit });
    },
  };

  const credentials: HmrcCredentials = {
    vatNumber: null,
    accessToken: ACCESS,
    refreshToken: 'refresh-secret',
    storedRefreshToken: 'stored',
    expiresAt: new Date('2099-01-01T00:00:00Z'),
  };
  const hmrcStore = {
    sandboxMode: async () => over.sandboxOptIn ?? true,
    credentials: async () => credentials,
    status: async () => ({ connected: true, expiresAt: null, itsBusinessId: BUSINESS_ID, itsPropertyBusinessId: PROPERTY_BUSINESS_ID, needsItsReconnect: false }),
    saveRefreshedTokens: async () => true,
  } as unknown as HmrcStore;
  const identifiers = { get: async () => ({ ninoEncrypted: encryptToken(NINO) }) } as unknown as TaxIdentifiersStore;
  const summaryStore: TaxYearSummaryStore = {
    loadLines: async (userId) => ledger[userId] ?? [],
    loadTrips: async () => [],
    loadChoice: async () => undefined,
  };
  const fetchFn = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(null, { status: 204 }));
  const deps: ItsSubmitDeps = { submissions, hmrcStore, identifiers, summaryStore, fetchFn, now: () => NOW };
  const request = new Request('https://app.example/api/hmrc/its-submit', { method: 'POST' });
  const confirm = (userId = 'user_a', declaration = true) => confirmItsUpdateForUser({ userId, ...target, declaration, request }, deps);
  const submit = (userId = 'user_a') => submitItsUpdateForUser({ userId, ...target, request }, deps);
  const confirmProperty = (userId = 'user_a') =>
    confirmItsUpdateForUser({ userId, ...target, declaration: true, request, kind: 'uk-property' }, deps);
  const submitProperty = (userId = 'user_a') => submitItsUpdateForUser({ userId, ...target, request, kind: 'uk-property' }, deps);
  return { submissions, ledger, rows, audits, fetchFn, confirm, submit, confirmProperty, submitProperty };
}

const refusalCode = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(VatReturnError);
  return (error as VatReturnError).code;
};

describe('Income Tax quarterly update submission', () => {
  beforeEach(() => {
    vi.stubEnv('HMRC_ITSA_ENABLED', 'true');
    vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
    vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses to confirm without the declaration', async () => {
    const t = setup();
    expect(await refusalCode(t.confirm('user_a', false))).toBe('DECLARATION_REQUIRED');
    expect(t.rows.size).toBe(0);
  });

  it('does not call HMRC without a confirmation', async () => {
    const t = setup();
    expect(await refusalCode(t.submit())).toBe('NOT_CONFIRMED');
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it('submits a confirmed update and marks it submitted', async () => {
    const t = setup();
    await t.confirm();
    await t.submit();
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
    expect([...t.rows.values()][0].status).toBe('submitted');
  });

  it('refuses a stale confirmation after the ledger changes', async () => {
    const t = setup();
    await t.confirm();
    t.ledger.user_a.push(incomeLine(-1));
    expect(await refusalCode(t.submit())).toBe('STALE_CONFIRMATION');
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a second submit for the same period', async () => {
    const t = setup();
    await t.confirm();
    await t.submit();
    expect(await refusalCode(t.submit())).toBe('ALREADY_SUBMITTED');
    expect(await refusalCode(t.confirm())).toBe('ALREADY_SUBMITTED');
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses a submit whose lock claim is lost to a concurrent request', async () => {
    const t = setup();
    await t.confirm();
    // The other request wins the claim between our read and our update.
    t.submissions.claim = async () => false;
    expect(await refusalCode(t.submit())).toBe('ALREADY_SUBMITTED');
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it('releases the lock on a definite rejection so the owner can confirm again', async () => {
    const t = setup();
    await t.confirm();
    t.fetchFn.mockResolvedValueOnce(Response.json({ code: 'RULE_INCORRECT', message: 'no' }, { status: 422 }));
    expect(await refusalCode(t.submit())).toBe('RULE_INCORRECT');
    expect([...t.rows.values()][0].status).toBe('rejected');
    await t.confirm();
    expect([...t.rows.values()][0].status).toBe('confirmed');
  });

  it('keeps the lock when HMRC answers 5xx', async () => {
    const t = setup();
    await t.confirm();
    t.fetchFn.mockResolvedValueOnce(Response.json({ code: 'SERVER_ERROR' }, { status: 503 }));
    expect(await refusalCode(t.submit())).toBe('OUTCOME_UNKNOWN');
    expect([...t.rows.values()][0].status).toBe('pending');
    expect(await refusalCode(t.confirm())).toBe('ALREADY_SUBMITTED');
  });

  it('keeps the lock on a network failure', async () => {
    const t = setup();
    await t.confirm();
    t.fetchFn.mockRejectedValueOnce(new TypeError('socket hang up'));
    expect(await refusalCode(t.submit())).toBe('OUTCOME_UNKNOWN');
    expect([...t.rows.values()][0].status).toBe('pending');
  });

  it('keeps the lock when the receipt cannot be saved', async () => {
    const t = setup();
    await t.confirm();
    const [row] = [...t.rows.values()];
    // Break the receipt write by deleting the row once HMRC has accepted.
    t.fetchFn.mockImplementationOnce(async () => {
      t.rows.delete(row.id);
      return new Response(null, { status: 204 });
    });
    expect(await refusalCode(t.submit())).toBe('OUTCOME_UNKNOWN');
  });

  it('writes audit snapshots with the request and fraud headers but no token', async () => {
    const t = setup();
    await t.confirm();
    await t.submit();
    const submitted = t.audits.find((audit) => audit.action === 'its_update.submitted')!;
    const text = JSON.stringify(t.audits);
    expect(text).not.toContain(ACCESS);
    expect(text.toLowerCase()).not.toContain('authorization');
    expect(submitted.snapshot).toMatchObject({ request: { periodIncome: { turnover: '1000.00' } } });
    expect(Object.keys((submitted.snapshot as { fraudHeaders: object }).fraudHeaders).length).toBeGreaterThan(0);
  });

  it('refuses when the server is live but the owner has not opted in', async () => {
    vi.stubEnv('HMRC_SANDBOX_MODE', 'false');
    const t = setup({ sandboxOptIn: true });
    expect(await refusalCode(t.confirm())).toBe('LIVE_MODE_REFUSED');
  });

  it('refuses when the owner opted into live but the server is sandbox', async () => {
    const t = setup({ sandboxOptIn: false });
    expect(await refusalCode(t.confirm())).toBe('LIVE_MODE_REFUSED');
  });

  it('refuses when Income Tax is switched off', async () => {
    vi.stubEnv('HMRC_ITSA_ENABLED', 'false');
    const t = setup();
    expect(await refusalCode(t.confirm())).toBe('ITSA_DISABLED');
  });

  it("cannot reach another user's confirmation", async () => {
    const t = setup();
    await t.confirm('user_a');
    expect(await refusalCode(t.submit('user_b'))).toBe('NOT_CONFIRMED');
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  describe('UK property', () => {
    it('does not call HMRC without a property confirmation', async () => {
      const t = setup();
      await t.confirm();
      expect(await refusalCode(t.submitProperty())).toBe('NOT_CONFIRMED');
      expect(t.fetchFn).not.toHaveBeenCalled();
    });

    it('sends only the rental figures to the property endpoint', async () => {
      const t = setup();
      await t.confirmProperty();
      await t.submitProperty();
      const [url, init] = t.fetchFn.mock.calls[0];
      expect(String(url)).toContain(`/individuals/business/property/uk/${NINO}/${PROPERTY_BUSINESS_ID}/cumulative/2026-27`);
      expect(JSON.parse(String(init?.body)).ukProperty.income).toEqual({ periodAmount: 800 });
    });

    it('lets a self-employment and a property update for one quarter both be filed', async () => {
      const t = setup();
      await t.confirm();
      await t.confirmProperty();
      await t.submit();
      await t.submitProperty();
      expect([...t.rows.values()].map((row) => row.status)).toEqual(['submitted', 'submitted']);
    });

    it('refuses a stale property confirmation and a second property submit', async () => {
      const t = setup();
      await t.confirmProperty();
      t.ledger.user_a.push(rentLine(-1));
      expect(await refusalCode(t.submitProperty())).toBe('STALE_CONFIRMATION');
      await t.confirmProperty();
      await t.submitProperty();
      expect(await refusalCode(t.submitProperty())).toBe('ALREADY_SUBMITTED');
    });

    it('refuses another user the first user\'s property confirmation', async () => {
      const t = setup();
      await t.confirmProperty('user_a');
      expect(await refusalCode(t.submitProperty('user_b'))).toBe('NOT_CONFIRMED');
      expect(t.fetchFn).not.toHaveBeenCalled();
    });
  });
});
