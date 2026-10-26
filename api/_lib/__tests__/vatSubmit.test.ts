import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import type { HmrcCredentials, HmrcStore } from '../hmrcStore';
import { prepareSubmission, submitVatReturnForUser } from '../vatSubmit';
import type { DrillLine, Period, SavedDraft, VatReturnStore } from '../vatReturns';
import { buildVatReturnFromLedger } from '../../../src/lib/vat';

const period: Period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };
const NOW = new Date('2026-10-26T10:00:00Z');
const OLD_ACCESS = 'access-OLD-secret';
const NEW_ACCESS = 'access-NEW-secret';

const line = (lineId: string, accountType: 'income' | 'expense', amountPence: number, vatPence: number): DrillLine => ({
  lineId,
  date: '2026-02-01',
  accountType,
  amountPence,
  vatPence,
  status: 'confirmed',
  deletedAt: null,
  description: lineId,
});
const sales = [line('s1', 'income', -10000, -2000), line('p1', 'expense', 4000, 800)];

function makeVatStore(ledger: Record<string, DrillLine[]>, confirmedFor: string[] = ['user_a']) {
  const drafts = new Map<string, SavedDraft>();
  const submissions = new Map<string, string>();
  const calls = { receipts: [] as unknown[], failed: [] as unknown[], audits: [] as unknown[] };
  const boxesFor = (userId: string) =>
    buildVatReturnFromLedger(ledger[userId] ?? [], period);
  for (const userId of confirmedFor) {
    drafts.set(`${userId}:${period.periodKey}`, {
      status: 'confirmed',
      periodStart: period.start,
      periodEnd: period.end,
      boxes: boxesFor(userId),
      confirmedAt: NOW.toISOString(),
    });
  }
  const store: VatReturnStore = {
    loadLedgerLines: async (userId) => ledger[userId] ?? [],
    findDraft: async (userId, key) => drafts.get(`${userId}:${key}`),
    saveDraft: async () => undefined,
    confirm: async () => undefined,
    findSubmission: async (userId, key, sandbox) => {
      const status = submissions.get(`${userId}:${key}:${sandbox}`);
      return status ? { status: status as 'pending' } : undefined;
    },
    claimSubmission: async (userId, key, sandbox) => {
      const id = `${userId}:${key}:${sandbox}`;
      if (submissions.has(id)) return undefined;
      submissions.set(id, 'pending');
      return id;
    },
    recordReceipt: async (_userId, id, receipt, audit) => {
      submissions.set(id, 'submitted');
      calls.receipts.push(receipt);
      calls.audits.push(audit);
    },
    listReturnHistory: async () => [],
    markFailed: async (_userId, id, audit) => {
      submissions.delete(id);
      calls.failed.push(audit);
    },
  };
  return { store, drafts, submissions, calls };
}

function makeHmrcStore(sandbox: boolean | undefined, overrides: Partial<HmrcCredentials> = {}) {
  const saved: string[] = [];
  const store: HmrcStore = {
    sandboxMode: async () => sandbox,
    setSandboxMode: vi.fn(),
    saveTokens: async () => undefined,
    credentials: async () => ({
      vatNumber: '123456789',
      accessToken: OLD_ACCESS,
      refreshToken: 'refresh-OLD',
      storedRefreshToken: 'cipher-OLD',
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      ...overrides,
    }),
    saveRefreshedTokens: async (_u, _s, tokens) => {
      saved.push(tokens.accessToken);
      return true;
    },
    status: async () => ({ connected: true, expiresAt: null }),
  };
  return { store, saved };
}

const receiptBody = { formBundleNumber: '256616960283', processingDate: '2026-10-26T10:00:01.000Z' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const request = new Request('https://app.test/api/vat/submit', { method: 'POST' });

// Obligations GETs are answered here; every other call goes to `fetchFn`, which therefore only sees submit POSTs.
let openObligations: unknown[];
let obligationsFetch: Mock<[url: string], Promise<Response>>;
const routeFetch = (submitFetch: FetchMock) =>
  ((url: string, init: unknown) =>
    url.includes('/obligations?') ? obligationsFetch(url) : submitFetch(url, init as never)) as unknown as typeof fetch;

const submit = (
  vat: ReturnType<typeof makeVatStore>,
  hmrc: ReturnType<typeof makeHmrcStore>,
  fetchFn: FetchMock,
  userId = 'user_a',
  refresh = vi.fn(async () => ({ accessToken: NEW_ACCESS, refreshToken: 'refresh-NEW', expiresAt: NOW.getTime() + 3_600_000 })),
) =>
  submitVatReturnForUser(
    { userId, period, request },
    { vatStore: vat.store, hmrcStore: hmrc.store, fetchFn: routeFetch(fetchFn), refresh, now: () => NOW },
  );

const rejects = async (promise: Promise<unknown>, status: number, code: string) =>
  expect(promise).rejects.toMatchObject({ status, code });

type FetchMock = Mock<[url: string, init: { body: string; headers: Record<string, string> }], Promise<Response>>;
let fetchFn: FetchMock;
beforeEach(() => {
  // withHmrcToken compares token expiry with Date.now(); pin it to NOW so the fixed fixtures stay valid.
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
  fetchFn = vi.fn(async () => json(receiptBody)) as unknown as FetchMock;
  openObligations = [{ periodKey: '26A1', start: '2026-01-01', end: '2026-03-31', due: '2026-05-07', status: 'O' }];
  obligationsFetch = vi.fn(async (_url: string) => json({ obligations: openObligations }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('submitVatReturnForUser', () => {
  it('submits a nil return (all nine boxes zero) and stores the receipt', async () => {
    const vat = makeVatStore({ user_a: [] });
    const result = await submit(vat, makeHmrcStore(true), fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://test-api.service.hmrc.gov.uk/organisations/vat/123456789/returns');
    expect(JSON.parse(init.body)).toEqual({
      periodKey: '26A1',
      vatDueSales: 0,
      vatDueAcquisitions: 0,
      totalVatDue: 0,
      vatReclaimedCurrPeriod: 0,
      netVatDue: 0,
      totalValueSalesExVAT: 0,
      totalValuePurchasesExVAT: 0,
      totalValueGoodsSuppliedExVAT: 0,
      totalAcquisitionsExVAT: 0,
      finalised: true,
    });
    expect(result).toEqual({ formBundleNumber: '256616960283', processingDate: receiptBody.processingDate, sandbox: true });
    expect(vat.calls.receipts).toEqual([
      { formBundleNumber: '256616960283', processingDate: new Date(receiptBody.processingDate) },
    ]);
  });

  it('sends the fraud prevention headers and stores them in the audit without the bearer token', async () => {
    const vat = makeVatStore({ user_a: sales });
    await submit(vat, makeHmrcStore(true), fetchFn);
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers['Gov-Client-Connection-Method']).toBe('WEB_APP_VIA_SERVER');
    expect(init.headers['Gov-Client-User-IDs']).toBe('stf=user_a');
    expect(init.headers['Gov-Vendor-Version']).toBe('stf=abc123');
    expect(JSON.stringify(vat.calls.audits)).not.toContain(OLD_ACCESS);
    expect(vat.calls.audits[0]).toMatchObject({ periodKey: '26A1', sandbox: true, response: receiptBody });
  });

  it('refreshes the token on a 401, persists it and retries once', async () => {
    fetchFn
      .mockResolvedValueOnce(json({ code: 'INVALID_CREDENTIALS', message: 'bad' }, 401))
      .mockResolvedValueOnce(json(receiptBody));
    const hmrc = makeHmrcStore(true);
    await submit(makeVatStore({ user_a: sales }), hmrc, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${NEW_ACCESS}`);
    expect(hmrc.saved).toEqual([NEW_ACCESS]);
  });

  describe('open obligation gate', () => {
    const refused = async (code = 'PERIOD_NOT_OPEN') => {
      const vat = makeVatStore({ user_a: sales });
      await rejects(submit(vat, makeHmrcStore(true), fetchFn), 409, code);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(vat.submissions.size).toBe(0);
    };

    it('asks HMRC for open obligations over the period range', async () => {
      await submit(makeVatStore({ user_a: sales }), makeHmrcStore(true), fetchFn);
      expect(obligationsFetch).toHaveBeenCalledWith(
        'https://test-api.service.hmrc.gov.uk/organisations/vat/123456789/obligations?from=2026-01-01&to=2026-03-31&status=O',
      );
    });

    it('refuses a period key that is not among the open obligations', async () => {
      openObligations = [{ periodKey: '26A2', start: '2026-01-01', end: '2026-03-31', due: '2026-05-07', status: 'O' }];
      await refused();
    });

    it('refuses the right key with different dates', async () => {
      openObligations = [{ periodKey: '26A1', start: '2026-01-01', end: '2026-04-30', due: '2026-05-07', status: 'O' }];
      await refused();
    });

    it('refuses a fulfilled obligation and an empty list', async () => {
      openObligations = [{ periodKey: '26A1', start: '2026-01-01', end: '2026-03-31', due: '2026-05-07', status: 'F' }];
      await refused();
      openObligations = [];
      await refused();
    });

    it('files the open 26C3 obligation for July to September', async () => {
      const julySeptember: Period = { periodKey: '26C3', start: '2026-07-01', end: '2026-09-30' };
      openObligations = [{ ...julySeptember, due: '2026-11-07', status: 'O' }];
      const vat = makeVatStore({ user_a: [] });
      vat.drafts.set('user_a:26C3', {
        status: 'confirmed',
        periodStart: julySeptember.start,
        periodEnd: julySeptember.end,
        boxes: buildVatReturnFromLedger([], julySeptember),
        confirmedAt: NOW.toISOString(),
      });
      await submitVatReturnForUser(
        { userId: 'user_a', period: julySeptember, request },
        { vatStore: vat.store, hmrcStore: makeHmrcStore(true).store, fetchFn: routeFetch(fetchFn), now: () => NOW },
      );
      expect(JSON.parse(fetchFn.mock.calls[0][1].body).periodKey).toBe('26C3');
      expect(vat.calls.receipts).toHaveLength(1);
    });

    it('surfaces an HMRC failure on the lookup without claiming or posting', async () => {
      obligationsFetch.mockResolvedValue(json({ code: 'SERVER_ERROR', message: 'x' }, 500));
      const vat = makeVatStore({ user_a: sales });
      await rejects(submit(vat, makeHmrcStore(true), fetchFn), 502, 'SERVER_ERROR');
      expect(fetchFn).not.toHaveBeenCalled();
      expect(vat.submissions.size).toBe(0);
    });
  });

  describe('mode gate', () => {
    const cases: Array<{ env: string; userSandbox: boolean; outcome: 'sandbox' | 'live' | 'refused' }> = [
      { env: 'true', userSandbox: true, outcome: 'sandbox' },
      { env: 'true', userSandbox: false, outcome: 'refused' },
      { env: 'false', userSandbox: true, outcome: 'refused' },
      { env: 'false', userSandbox: false, outcome: 'live' },
    ];
    it.each(cases)('env=$env userSandbox=$userSandbox -> $outcome', async ({ env, userSandbox, outcome }) => {
      vi.stubEnv('HMRC_SANDBOX_MODE', env);
      const vat = makeVatStore({ user_a: sales });
      const attempt = submit(vat, makeHmrcStore(userSandbox), fetchFn);
      if (outcome === 'refused') {
        await rejects(attempt, 409, 'MODE_MISMATCH');
        expect(fetchFn).not.toHaveBeenCalled();
        expect(vat.submissions.size).toBe(0);
        return;
      }
      await attempt;
      const url = fetchFn.mock.calls[0][0];
      expect(url.startsWith(outcome === 'live' ? 'https://api.service.hmrc.gov.uk/' : 'https://test-api.service.hmrc.gov.uk/')).toBe(true);
    });

    it('refuses when the user row is missing', async () => {
      await rejects(submit(makeVatStore({ user_a: sales }), makeHmrcStore(undefined), fetchFn), 409, 'MODE_MISMATCH');
    });
  });

  it('refuses a second submit for the period without calling HMRC', async () => {
    const vat = makeVatStore({ user_a: sales });
    const hmrc = makeHmrcStore(true);
    await submit(vat, hmrc, fetchFn);
    await rejects(submit(vat, hmrc, fetchFn), 409, 'ALREADY_SUBMITTED');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses an unconfirmed return and a ledger that changed since confirmation', async () => {
    await rejects(submit(makeVatStore({ user_a: sales }, []), makeHmrcStore(true), fetchFn), 409, 'NOT_CONFIRMED');
    const vat = makeVatStore({ user_a: sales });
    vat.drafts.set(`user_a:26A1`, { ...vat.drafts.get('user_a:26A1')!, boxes: buildVatReturnFromLedger([], period) });
    await rejects(submit(vat, makeHmrcStore(true), fetchFn), 409, 'STALE_CONFIRMATION');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses another user's confirmed return", async () => {
    const vat = makeVatStore({ user_a: sales, user_b: sales }, ['user_a']);
    await rejects(submit(vat, makeHmrcStore(true), fetchFn, 'user_b'), 409, 'NOT_CONFIRMED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses when HMRC is not connected or the VAT number is missing', async () => {
    const vat = makeVatStore({ user_a: sales });
    const disconnected = makeHmrcStore(true);
    disconnected.store.credentials = async () => undefined;
    await rejects(submit(vat, disconnected, fetchFn), 409, 'HMRC_NOT_CONNECTED');
    await rejects(submit(vat, makeHmrcStore(true, { vatNumber: null }), fetchFn), 409, 'VAT_NUMBER_MISSING');
    expect(vat.submissions.size).toBe(0);
  });

  it('marks the claim failed on a definite HMRC 4xx so the user can retry', async () => {
    fetchFn.mockResolvedValue(json({ code: 'INVALID_REQUEST', message: 'bad' }, 400));
    const vat = makeVatStore({ user_a: sales });
    await rejects(submit(vat, makeHmrcStore(true), fetchFn), 502, 'INVALID_REQUEST');
    expect(vat.calls.failed).toHaveLength(1);
    expect(vat.submissions.size).toBe(0);
  });

  it.each([
    ['HMRC 500', () => fetchFn.mockResolvedValue(json({ code: 'SERVER_ERROR', message: 'x' }, 500))],
    ['a network error', () => fetchFn.mockRejectedValue(new TypeError('socket hang up'))],
  ])('leaves the row pending after %s and refuses a retry', async (_name, arrange) => {
    arrange();
    const vat = makeVatStore({ user_a: sales });
    const hmrc = makeHmrcStore(true);
    await rejects(submit(vat, hmrc, fetchFn), 502, 'OUTCOME_UNKNOWN');
    expect(vat.calls.failed).toHaveLength(0);
    expect(vat.submissions.get('user_a:26A1:true')).toBe('pending');
    await rejects(submit(vat, hmrc, fetchFn), 409, 'ALREADY_SUBMITTED');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('treats DUPLICATE_SUBMISSION as filed elsewhere: no retry, claim kept', async () => {
    fetchFn.mockResolvedValue(json({ code: 'DUPLICATE_SUBMISSION', message: 'dup' }, 403));
    const vat = makeVatStore({ user_a: sales });
    await rejects(submit(vat, makeHmrcStore(true), fetchFn), 409, 'DUPLICATE_SUBMISSION');
    expect(vat.calls.failed).toHaveLength(0);
    expect(vat.submissions.get('user_a:26A1:true')).toBe('pending');
  });

  it('reports an unknown outcome when HMRC accepted but the receipt could not be saved', async () => {
    const vat = makeVatStore({ user_a: sales });
    vat.store.recordReceipt = async () => {
      throw new Error('db down');
    };
    await rejects(submit(vat, makeHmrcStore(true), fetchFn), 502, 'OUTCOME_UNKNOWN');
  });
});

describe('prepareSubmission', () => {
  const prepare = (vat: ReturnType<typeof makeVatStore>, hmrc: ReturnType<typeof makeHmrcStore>, userId = 'user_a') =>
    prepareSubmission({ userId, period, request }, vat.store, hmrc.store, () => NOW);

  it('builds the payload, fraud headers and mode without claiming or calling HMRC', async () => {
    const vat = makeVatStore({ user_a: sales });
    const prepared = await prepare(vat, makeHmrcStore(true));
    expect(prepared.sandbox).toBe(true);
    expect(prepared.vatNumber).toBe('123456789');
    expect(prepared.payload.periodKey).toBe('26A1');
    expect(prepared.payload.finalised).toBe(true);
    expect(prepared.fraudHeaders['Gov-Client-User-IDs']).toBeDefined();
    expect(vat.submissions.size).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses an unconfirmed return, a mode mismatch and missing credentials', async () => {
    const vat = makeVatStore({ user_a: sales, user_b: sales }, ['user_a']);
    await rejects(prepare(vat, makeHmrcStore(true), 'user_b'), 409, 'NOT_CONFIRMED');
    await rejects(prepare(vat, makeHmrcStore(false)), 409, 'MODE_MISMATCH');
    await rejects(prepare(vat, makeHmrcStore(true, { vatNumber: null })), 409, 'VAT_NUMBER_MISSING');
  });
});
