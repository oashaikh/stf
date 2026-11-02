// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { confirmItsAnnual, previewItsAnnual, submitItsAnnual } from './itsAnnualApi';

const stubFetch = (body: unknown) => {
  const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(body));
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
};

const sentBody = (fetchSpy: ReturnType<typeof stubFetch>) => JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('itsAnnualApi', () => {
  it('previews by naming only the tax year and returns the server body', async () => {
    const fetchSpy = stubFetch({ ok: true, data: { endpoint: { method: 'PUT', url: 'u', sandbox: true }, body: { allowances: { tradingIncomeAllowance: '1000.00' } }, headers: {} } });
    const preview = await previewItsAnnual('2026-27');
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/hmrc/its-annual-preview');
    expect(sentBody(fetchSpy)).toEqual({ taxYear: '2026-27' });
    expect(preview.body.allowances?.tradingIncomeAllowance).toBe('1000.00');
  });

  it('confirms with the declaration set', async () => {
    const fetchSpy = stubFetch({ ok: true, data: { sandbox: true, body: {} } });
    await confirmItsAnnual('2026-27');
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/hmrc/its-annual-confirm');
    expect(sentBody(fetchSpy)).toEqual({ taxYear: '2026-27', declaration: true });
  });

  it('submits with confirm set and returns the sandbox flag', async () => {
    const fetchSpy = stubFetch({ ok: true, data: { sandbox: true } });
    expect(await submitItsAnnual('2026-27')).toEqual({ sandbox: true });
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/hmrc/its-annual-submit');
    expect(sentBody(fetchSpy)).toEqual({ taxYear: '2026-27', confirm: true });
  });

  it('throws the server message when a route refuses', async () => {
    stubFetch({ ok: false, code: 'NOT_CONFIRMED', error: 'Confirm this submission before sending it' });
    await expect(submitItsAnnual('2026-27')).rejects.toThrow('Confirm this submission before sending it');
  });
});
