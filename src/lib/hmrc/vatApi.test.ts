// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchVatObligations, NotConnectedError, VatNumberMissingError } from './vatApi';

const obligation = { periodKey: '18A1', start: '2026-01-01', end: '2026-03-31', due: '2026-05-07', status: 'O', overdue: false };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

describe('fetchVatObligations', () => {
  beforeEach(() => localStorage.clear());

  it('sends the bearer token and browser fraud headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, obligations: [obligation] }));
    expect(await fetchVatObligations('tok', fetchMock)).toEqual([obligation]);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/vat/obligations');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['x-stf-timezone']).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
    expect(init.headers['x-stf-screens']).toContain('width=');
    expect(init.headers['x-stf-window-size']).toContain('height=');
    expect(init.headers['x-stf-js-user-agent']).toBe(navigator.userAgent);
    expect(init.headers['x-stf-device-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps the same device id across calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, obligations: [] }));
    await fetchVatObligations('tok', fetchMock);
    await fetchVatObligations('tok', fetchMock);
    const ids = fetchMock.mock.calls.map(([, init]) => init.headers['x-stf-device-id']);
    expect(ids[0]).toBe(ids[1]);
    expect(localStorage.getItem('stf-device-id')).toBe(ids[0]);
  });

  it('throws NotConnectedError on 409', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, code: 'HMRC_NOT_CONNECTED' }, 409));
    await expect(fetchVatObligations('tok', fetchMock)).rejects.toBeInstanceOf(NotConnectedError);
  });

  it('throws VatNumberMissingError when the VAT number is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, code: 'VAT_NUMBER_MISSING' }, 409));
    const failure = await fetchVatObligations('tok', fetchMock).catch((error) => error);
    expect(failure).toBeInstanceOf(VatNumberMissingError);
    expect(failure).not.toBeInstanceOf(NotConnectedError);
  });

  it('throws a plain error on other failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 502));
    const failure = await fetchVatObligations('tok', fetchMock).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(NotConnectedError);
  });
});
