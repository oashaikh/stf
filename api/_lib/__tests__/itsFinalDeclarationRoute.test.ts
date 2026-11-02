import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { encryptToken } from '../../../server/src/lib/hmrcCrypto';
import { createItsFinalConfirmHandler } from '../../hmrc/its-final-confirm';
import { createItsFinalPreviewHandler } from '../../hmrc/its-final-preview';
import { createItsFinalSubmitHandler } from '../../hmrc/its-final-submit';
import type { AuthDeps } from '../auth';
import type { HmrcStore } from '../hmrcStore';
import type { ItsFinalDeps, ItsFinalStore } from '../itsFinalDeclaration';
import type { TaxIdentifiersStore } from '../taxIdentifiers';
import type { TaxYearSummaryStore } from '../taxYearSummary';

const target = { taxYear: '2026-27' };
const confirmBody = { ...target, calculationId: 'calc-1', declaration: true };
const submitBody = { ...target, confirm: true };

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

function fakeDeps({ userSandbox = true, annualSubmitted = true }: { userSandbox?: boolean; annualSubmitted?: boolean } = {}) {
  type Row = { id: string; userId: string; status: 'confirmed' | 'pending' | 'submitted' | 'rejected'; calculationId: string };
  const rows = new Map<string, Row>();
  const auditActions: string[] = [];
  const key = (userId: string, period: { taxYear: string; sandbox: boolean }) => `${userId}:${period.taxYear}:${period.sandbox}`;
  const submissions: ItsFinalStore = {
    submittedAnnualBusinesses: async () => (annualSubmitted ? ['self-employment'] : []),
    find: async (userId, period) => {
      const row = rows.get(key(userId, period));
      return row && { id: row.id, status: row.status, calculationId: row.calculationId };
    },
    saveConfirmed: async (userId, period, calculation) => {
      rows.set(key(userId, period), { id: key(userId, period), userId, status: 'confirmed', calculationId: calculation.calculationId });
      auditActions.push('confirmed');
      return true;
    },
    claim: async (userId, id) => {
      const row = rows.get(id);
      if (!row || row.userId !== userId || row.status !== 'confirmed') return false;
      row.status = 'pending';
      return true;
    },
    markRejected: async () => {
      auditActions.push('rejected');
    },
    recordReceipt: async (_userId, id) => {
      rows.get(id)!.status = 'submitted';
      auditActions.push('submitted');
    },
  };
  const hmrcStore = {
    sandboxMode: async () => userSandbox,
    credentials: async () => ({
      vatNumber: null,
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      storedRefreshToken: 'refresh-secret',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    }),
    status: async () => ({ connected: true, expiresAt: null, itsBusinessId: 'XAIS12345678901', needsItsReconnect: false }),
    saveRefreshedTokens: async () => true,
  } as unknown as HmrcStore;
  const summaryStore: TaxYearSummaryStore = { loadLines: async () => [], loadTrips: async () => [], loadChoice: async () => 'allowance' };
  const fetchFn = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
    const path = String(url);
    if (path.endsWith('/final-declaration')) return new Response(null, { status: 204 });
    if (path.endsWith('/intent-to-finalise')) return Response.json({ calculationId: 'calc-1' });
    return Response.json({
      calculation: { taxCalculation: { incomeTax: { incomeTaxCharged: 100.5 }, nics: { class4Nics: { totalClass4Charge: 20 } }, totalIncomeTaxAndNicsDue: 120.5 } },
    });
  });
  const deps: ItsFinalDeps = {
    submissions,
    hmrcStore,
    identifiers: { get: async () => ({ ninoEncrypted: encryptToken('QQ123456C') }) } as unknown as TaxIdentifiersStore,
    summaryStore,
    fetchFn,
  };
  return { deps, fetchFn, auditActions, rows };
}

const post = (handler: (request: Request) => Promise<Response>, body: unknown, token: string | null = 'tok-u1', method = 'POST') =>
  handler(
    new Request('https://app.test/api/hmrc/its-final', {
      method,
      headers: token ? { cookie: `stf_session=${token}` } : {},
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
  );

beforeEach(() => {
  vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  vi.stubEnv('HMRC_ITSA_ENABLED', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  ['preview', createItsFinalPreviewHandler, target],
  ['confirm', createItsFinalConfirmHandler, confirmBody],
  ['submit', createItsFinalSubmitHandler, submitBody],
] as const)('POST /api/hmrc/its-final-%s', (_name, create, valid) => {
  const setup = () => {
    const { deps, fetchFn } = fakeDeps();
    return { handler: (request: Request) => create(deps, authDeps)(request), fetchFn };
  };

  it('returns 401 without a session', async () => {
    const { handler, fetchFn } = setup();
    expect((await post(handler, valid, null)).status).toBe(401);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects other methods with 405', async () => {
    expect((await post(setup().handler, undefined, 'tok-u1', 'GET')).status).toBe(405);
  });

  it.each([
    ['extra key', { ...valid, userId: 'u2' }],
    ['unknown year', { ...valid, taxYear: '2019-20' }],
    ['not an object', 'yes'],
  ])('answers 400 for %s', async (_label, body) => {
    const { handler, fetchFn } = setup();
    expect((await post(handler, body)).status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('answers 404 when Income Tax is off', async () => {
    vi.stubEnv('HMRC_ITSA_ENABLED', 'false');
    const { handler, fetchFn } = setup();
    expect((await post(handler, valid)).status).toBe(404);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('final declaration gate over HTTP', () => {
  it.each([
    ['preview', createItsFinalPreviewHandler, target],
    ['confirm', createItsFinalConfirmHandler, confirmBody],
    ['submit', createItsFinalSubmitHandler, submitBody],
  ] as const)('%s answers 409 and calls HMRC nothing while the yearly figures are not in', async (_name, create, body) => {
    const { deps, fetchFn } = fakeDeps({ annualSubmitted: false });
    const res = await post((r) => create(deps, authDeps)(r), body);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('ANNUAL_FIGURES_MISSING');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('preview returns HMRC figures beside the estimate and the wording', async () => {
    const { deps, auditActions } = fakeDeps();
    const res = await post((r) => createItsFinalPreviewHandler(deps, authDeps)(r), target);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.calculationId).toBe('calc-1');
    expect(data.hmrc).toEqual({ incomeTaxPence: 10050, class2NicPence: 0, class4NicPence: 2000, totalPence: 12050 });
    expect(data.stfEstimate.totalPence).toBe(0);
    expect(data.comparison.differs).toBe(true);
    expect(data.declarationWording).toContain('I declare');
    expect(auditActions).toEqual([]);
  });

  it.each([['missing', confirmBody.calculationId && { taxYear: '2026-27', calculationId: 'calc-1' }], ['false', { ...confirmBody, declaration: false }]])(
    'refuses confirm when the tick is %s, with no HMRC call and no audit event',
    async (_label, body) => {
      const { deps, fetchFn, auditActions } = fakeDeps();
      expect((await post((r) => createItsFinalConfirmHandler(deps, authDeps)(r), body)).status).toBe(400);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(auditActions).toEqual([]);
    },
  );

  it.each([['missing', target], ['false', { ...target, confirm: false }]])('refuses submit when confirm is %s', async (_label, body) => {
    const { deps, fetchFn } = fakeDeps();
    expect((await post((r) => createItsFinalSubmitHandler(deps, authDeps)(r), body)).status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('confirm with the tick stores the calculation and writes one audit event', async () => {
    const { deps, auditActions } = fakeDeps();
    expect((await post((r) => createItsFinalConfirmHandler(deps, authDeps)(r), confirmBody)).status).toBe(200);
    expect(auditActions).toEqual(['confirmed']);
  });

  it('refuses a submit with no stored confirmation', async () => {
    const { deps, fetchFn } = fakeDeps();
    const res = await post((r) => createItsFinalSubmitHandler(deps, authDeps)(r), submitBody);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NOT_CONFIRMED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends the declaration once and nothing on a repeat submit', async () => {
    const { deps, fetchFn, auditActions } = fakeDeps();
    await post((r) => createItsFinalConfirmHandler(deps, authDeps)(r), confirmBody);
    fetchFn.mockClear();
    expect((await post((r) => createItsFinalSubmitHandler(deps, authDeps)(r), submitBody)).status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const second = await post((r) => createItsFinalSubmitHandler(deps, authDeps)(r), submitBody);
    expect(second.status).toBe(409);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(auditActions).toEqual(['confirmed', 'submitted']);
  });

  it("refuses a second user the first user's confirmation and sends nothing to HMRC", async () => {
    const { deps, fetchFn } = fakeDeps();
    await post((r) => createItsFinalConfirmHandler(deps, authDeps)(r), confirmBody, 'tok-u1');
    fetchFn.mockClear();
    const res = await post((r) => createItsFinalSubmitHandler(deps, authDeps)(r), submitBody, 'tok-u2');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NOT_CONFIRMED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['env says live but the owner has not opted in', 'false', true],
    ['the owner opted in but the env is sandbox', 'true', false],
  ])('blocks live when %s', async (_label, envMode, userSandbox) => {
    vi.stubEnv('HMRC_SANDBOX_MODE', envMode);
    const { deps, fetchFn } = fakeDeps({ userSandbox });
    for (const [create, body] of [
      [createItsFinalPreviewHandler, target],
      [createItsFinalConfirmHandler, confirmBody],
      [createItsFinalSubmitHandler, submitBody],
    ] as const) {
      const res = await post((r) => create(deps, authDeps)(r), body);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('LIVE_MODE_REFUSED');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
