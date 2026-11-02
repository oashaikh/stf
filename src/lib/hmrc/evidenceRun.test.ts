import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestUsers,
  maskNino,
  renderEvidenceNote,
  runEvidenceSteps,
  type EvidenceContext,
} from './evidenceRun';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { method: string; url: string };

/** Answers every endpoint STF uses with a small valid body; `failing` is a URL fragment that gets a 403. */
function fakeHmrc(failing?: string) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    if (failing && url.includes(failing)) return json({ code: 'FORBIDDEN', message: 'secret-body' }, 403);
    if (url.endsWith('/oauth/token')) return json({ access_token: 'app-token' });
    if (url.includes('/test/fraud-prevention-headers/validate')) return json({ code: 'VALID_HEADERS', message: 'ok' });
    if (url.includes('/organisations/vat/') && url.includes('/obligations'))
      return json({ obligations: [{ start: '2017-04-01', end: '2017-06-30', due: '2017-08-07', status: 'O', periodKey: '17A1' }] });
    if (method === 'POST' && url.endsWith('/returns')) return json({ formBundleNumber: '1234', processingDate: '2017-08-01' });
    if (url.includes('/organisations/vat/') && url.includes('/returns/')) return json({ periodKey: '17A1' });
    if (url.includes('/business/details/'))
      return json({
        businessDetails: [
          { businessId: 'XAIS12345678901', typeOfBusiness: 'self-employment' },
          { businessId: 'XPIS12345678901', typeOfBusiness: 'uk-property' },
        ],
      });
    if (url.includes('/obligations/details/') && url.includes('crystallisation')) return json({ obligations: [] });
    if (url.includes('/obligations/details/')) return json({ obligations: [] });
    if (url.includes('/adjustable-summary/') && url.endsWith('/trigger')) return json({ calculationId: 'bsas-1' });
    if (url.includes('/adjustable-summary/')) return json({ adjustableSummaryCalculation: { totalIncome: 10 } });
    if (url.includes('tax-liability-adjustments')) return json({ adjustments: [] });
    if (url.endsWith('/trigger/intent-to-finalise')) return json({ calculationId: 'calc-1' });
    if (url.endsWith('/final-declaration')) return new Response(null, { status: 204 });
    if (url.includes('/calculations/'))
      return json({ calculation: { taxCalculation: { incomeTax: { incomeTaxCharged: 1 }, totalIncomeTaxAndNicsDue: 1 } } });
    if (method === 'PUT') return new Response(null, { status: 204 });
    return json({}, 404);
  }) as typeof fetch;
  return { fetchFn, calls };
}

const context = (fetchFn: typeof fetch): EvidenceContext => ({
  fetchFn,
  fraudHeaders: { 'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER' },
  vat: { vrn: '666000001', accessToken: 'vat-token' },
  its: { nino: 'AA123456A', accessToken: 'its-token' },
  taxYear: '2026-27',
});

describe('runEvidenceSteps', () => {
  beforeEach(() => {
    vi.stubEnv('HMRC_CLIENT_ID', 'client-id');
    vi.stubEnv('HMRC_CLIENT_SECRET', 'client-secret');
  });

  it('calls every endpoint STF uses and reports each as passed', async () => {
    const { fetchFn, calls } = fakeHmrc();
    const results = await runEvidenceSteps(context(fetchFn));
    expect(results.filter((r) => !r.ok)).toEqual([]);
    const hit = (method: string, fragment: string) =>
      expect(calls.some((c) => c.method === method && c.url.includes(fragment)), `${method} ${fragment}`).toBe(true);
    hit('GET', '/test/fraud-prevention-headers/validate');
    hit('GET', '/organisations/vat/666000001/obligations');
    hit('POST', '/organisations/vat/666000001/returns');
    hit('GET', '/organisations/vat/666000001/returns/17A1');
    hit('GET', '/individuals/business/details/AA123456A/list');
    hit('GET', '/obligations/details/AA123456A/income-and-expenditure');
    hit('GET', '/obligations/details/AA123456A/crystallisation');
    hit('PUT', '/self-employment/AA123456A/XAIS12345678901/cumulative/2026-27');
    hit('PUT', '/self-employment/AA123456A/XAIS12345678901/annual/2026-27');
    hit('PUT', '/property/uk/AA123456A/XPIS12345678901/cumulative/2026-27');
    hit('PUT', '/property/uk/AA123456A/XPIS12345678901/annual/2026-27');
    hit('POST', '/adjustable-summary/AA123456A/trigger');
    hit('GET', '/adjustable-summary/AA123456A/self-employment/bsas-1');
    hit('GET', '/tax-liability-adjustments/AA123456A/2026-27');
    hit('POST', '/trigger/intent-to-finalise');
    hit('GET', '/calculations/AA123456A/self-assessment/2026-27/calc-1');
    hit('POST', '/calc-1/final-declaration');
  });

  it('marks a failed step failed with the HMRC code, never the response text', async () => {
    const { fetchFn } = fakeHmrc('/cumulative/');
    const results = await runEvidenceSteps(context(fetchFn));
    const failed = results.filter((r) => !r.ok);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].detail).toContain('FORBIDDEN');
    expect(JSON.stringify(results)).not.toContain('secret-body');
  });

  it('fails dependent steps instead of skipping them when business details fail', async () => {
    const { fetchFn } = fakeHmrc('/business/details/');
    const results = await runEvidenceSteps(context(fetchFn));
    const byName = (needle: string) => results.find((r) => r.name.toLowerCase().includes(needle))!;
    expect(byName('self-employment quarterly').ok).toBe(false);
    expect(byName('property annual').ok).toBe(false);
  });
});

describe('renderEvidenceNote', () => {
  beforeEach(() => {
    vi.stubEnv('HMRC_CLIENT_ID', 'client-id');
    vi.stubEnv('HMRC_CLIENT_SECRET', 'client-secret');
  });

  const users = { organisationUserId: '111111111111', individualUserId: '222222222222', vrn: '666000001', nino: 'AA123456A' };

  it('lists each step with PASS or FAIL and holds no secrets or full NINO', async () => {
    const { fetchFn } = fakeHmrc('/final-declaration');
    const ctx = context(fetchFn);
    const results = await runEvidenceSteps(ctx);
    const note = renderEvidenceNote({ date: '2026-11-02', users, results });
    for (const result of results) expect(note).toContain(result.endpoint);
    expect(note).toMatch(/\| PASS \|/);
    expect(note).toMatch(/\| FAIL \|/);
    expect(note).toContain('111111111111');
    expect(note).not.toContain('AA123456A');
    expect(note).toContain('AA****56A');
    expect(note).not.toMatch(/token|password/i);
  });

  it('masks a NINO to its first two and last three characters', () => {
    expect(maskNino('AB123456C')).toBe('AB****56C');
  });
});

describe('createTestUsers', () => {
  beforeEach(() => {
    vi.stubEnv('HMRC_CLIENT_ID', 'client-id');
    vi.stubEnv('HMRC_CLIENT_SECRET', 'client-secret');
  });

  it('asks for a VAT organisation and an Income Tax individual with both business types', async () => {
    const bodies: Record<string, unknown> = {};
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/oauth/token')) return json({ access_token: 'app-token' });
      bodies[url] = JSON.parse(String(init?.body));
      return url.endsWith('/organisations')
        ? json({ userId: '111', password: 'pw1', vrn: '666000001' })
        : json({ userId: '222', password: 'pw2', nino: 'AA123456A' });
    }) as typeof fetch;
    const users = await createTestUsers(fetchFn);
    expect(users).toMatchObject({ organisationUserId: '111', individualUserId: '222', vrn: '666000001', nino: 'AA123456A' });
    const [orgBody, individualBody] = Object.values(bodies) as { serviceNames: string[]; individualDetails?: unknown }[];
    expect(orgBody.serviceNames).toContain('mtd-vat');
    expect(individualBody.serviceNames).toContain('mtd-income-tax');
  });
});
