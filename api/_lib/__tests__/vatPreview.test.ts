import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import type { HmrcStore } from '../hmrcStore';
import { previewVatReturnForUser } from '../vatPreview';
import { submitVatReturnForUser } from '../vatSubmit';
import type { DrillLine, Period, SavedDraft, VatReturnStore } from '../vatReturns';
import { buildVatReturnFromLedger } from '../../../src/lib/vat';

const period: Period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };
const NOW = new Date('2026-10-26T10:00:00Z');
const ACCESS = 'access-secret-1';
const REFRESH = 'refresh-secret-1';

const line = (lineId: string, accountType: 'income' | 'expense', amountPence: number, vatPence: number): DrillLine => ({
  lineId, transactionId: lineId, date: '2026-02-01', accountType, amountPence, vatPence, status: 'confirmed', deletedAt: null, description: lineId,
});
const ledgers = {
  normal: [line('s1', 'income', -10000, -2000), line('p1', 'expense', 4000, 800)],
  nil: [] as DrillLine[],
};

function makeVatStore(ledger: DrillLine[], confirmed = true) {
  const draft: SavedDraft = {
    status: confirmed ? 'confirmed' : 'draft',
    periodStart: period.start,
    periodEnd: period.end,
    boxes: buildVatReturnFromLedger(ledger, period),
    confirmedAt: NOW.toISOString(),
  };
  const claimSubmission = vi.fn(async () => 'sub-1');
  const store = {
    loadLedgerLines: async () => ledger,
    findDraft: async () => draft,
    findSubmission: async () => undefined,
    claimSubmission,
    recordReceipt: async () => undefined,
    markFailed: async () => undefined,
  } as unknown as VatReturnStore;
  return { store, claimSubmission };
}

const hmrcStore = (sandbox: boolean | undefined, vatNumber = '123456789') =>
  ({
    sandboxMode: async () => sandbox,
    credentials: async () => ({
      vatNumber,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      storedRefreshToken: 'cipher',
      expiresAt: new Date(NOW.getTime() + 3_600_000),
    }),
    saveRefreshedTokens: async () => true,
  }) as unknown as HmrcStore;

const request = new Request('https://app.test/api/vat/preview', { method: 'POST' });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const noAudit = async () => undefined;

beforeEach(() => {
  // withHmrcToken compares token expiry with Date.now(); pin it to NOW so the fixed fixtures stay valid.
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('previewVatReturnForUser', () => {
  it.each(Object.entries(ledgers))('previews the same body the submit sends for a %s return', async (_name, ledger) => {
    const sent = vi.fn(async (url: string, _init?: { body: string }) =>
      url.includes('/obligations?')
        ? json({ obligations: [{ periodKey: '26A1', start: period.start, end: period.end, due: '2026-05-07', status: 'O' }] })
        : json({ formBundleNumber: '1', processingDate: NOW.toISOString() }),
    );
    await submitVatReturnForUser(
      { userId: 'user_a', period, request },
      { vatStore: makeVatStore(ledger).store, hmrcStore: hmrcStore(true), fetchFn: sent as unknown as typeof fetch, now: () => NOW },
    );
    const submitCall = sent.mock.calls.find(([url]) => !url.includes('/obligations?'))!;

    const preview = await previewVatReturnForUser(
      { userId: 'user_a', period, request },
      { vatStore: makeVatStore(ledger).store, hmrcStore: hmrcStore(true), now: () => NOW, recordPreview: noAudit },
    );

    expect(preview.body).toEqual(JSON.parse(submitCall[1]!.body));
  });

  it('makes no HMRC call, claims no submission and leaks no token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const logs = (['log', 'info', 'warn', 'error'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const vat = makeVatStore(ledgers.normal);
    const record = vi.fn(noAudit);

    const preview = await previewVatReturnForUser(
      { userId: 'user_a', period, request },
      { vatStore: vat.store, hmrcStore: hmrcStore(true), now: () => NOW, recordPreview: record },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vat.claimSubmission).not.toHaveBeenCalled();
    const everything = JSON.stringify(preview) + JSON.stringify(logs.map((spy) => spy.mock.calls)) + JSON.stringify(record.mock.calls);
    expect(everything).not.toContain(ACCESS);
    expect(everything).not.toContain(REFRESH);
    expect(preview.headers.Authorization).toBe('Bearer (hidden)');
    expect(preview.headers['Gov-Client-Connection-Method']).toBe('WEB_APP_VIA_SERVER');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('user_a', { periodKey: '26A1', sandbox: true });
  });

  it('masks the VRN to its last 3 digits and shows the sandbox endpoint', async () => {
    const preview = await previewVatReturnForUser(
      { userId: 'user_a', period, request },
      { vatStore: makeVatStore(ledgers.normal).store, hmrcStore: hmrcStore(true), now: () => NOW, recordPreview: noAudit },
    );
    expect(preview.endpoint).toEqual({
      method: 'POST',
      url: 'https://test-api.service.hmrc.gov.uk/organisations/vat/******789/returns',
      sandbox: true,
    });
  });

  it('shows the live host when both switches are live', async () => {
    vi.stubEnv('HMRC_SANDBOX_MODE', 'false');
    const preview = await previewVatReturnForUser(
      { userId: 'user_a', period, request },
      { vatStore: makeVatStore(ledgers.normal).store, hmrcStore: hmrcStore(false), now: () => NOW, recordPreview: noAudit },
    );
    expect(preview.endpoint.sandbox).toBe(false);
    expect(preview.endpoint.url).toMatch(/^https:\/\/api\.service\.hmrc\.gov\.uk\//);
  });

  it.each([
    ['NOT_CONFIRMED', () => makeVatStore(ledgers.normal, false).store, () => hmrcStore(true)],
    ['MODE_MISMATCH', () => makeVatStore(ledgers.normal).store, () => hmrcStore(false)],
    ['VAT_NUMBER_MISSING', () => makeVatStore(ledgers.normal).store, () => hmrcStore(true, '')],
  ])('refuses with %s and records no audit event', async (code, vatStore, store) => {
    const record = vi.fn(noAudit);
    await expect(
      previewVatReturnForUser({ userId: 'user_a', period, request }, { vatStore: vatStore(), hmrcStore: store(), now: () => NOW, recordPreview: record }),
    ).rejects.toMatchObject({ code });
    expect(record).not.toHaveBeenCalled();
  });
});
