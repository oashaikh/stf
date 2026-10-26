// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchVatHistory, fetchVatObligations, NotConnectedError, previewVatReturn, SubmitVatError, submitVatReturn, VatNumberMissingError } from './vatApi';

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

describe('submitVatReturn', () => {
  const period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };

  it('posts the period with explicit confirmation and fraud headers, and returns the receipt', async () => {
    const receipt = { formBundleNumber: '256 SANDBOX 1', processingDate: '2026-04-02T10:00:00.000Z', sandbox: true };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: receipt }));
    expect(await submitVatReturn('tok', period, fetchMock)).toEqual(receipt);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/vat/submit');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['x-stf-device-id']).toBeTruthy();
    expect(JSON.parse(init.body)).toEqual({ ...period, confirm: true });
  });

  it('throws with the server code when the outcome is unknown', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, code: 'OUTCOME_UNKNOWN', error: 'Do not resubmit' }, 502));
    await expect(submitVatReturn('tok', period, fetchMock)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await expect(submitVatReturn('tok', period, fetchMock)).rejects.toBeInstanceOf(SubmitVatError);
  });
});

describe('fetchVatHistory', () => {
  beforeEach(() => localStorage.clear());

  it('sends the bearer token and returns the history items', async () => {
    const item = { periodKey: '26A1', status: 'draft' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: [item] }));
    expect(await fetchVatHistory('tok', fetchMock)).toEqual([item]);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/vat/history');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('throws when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 500));
    await expect(fetchVatHistory('tok', fetchMock)).rejects.toThrow('Request to /api/vat/history failed');
  });
});

describe('previewVatReturn', () => {
  beforeEach(() => localStorage.clear());
  const period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };

  it('posts only the period with the bearer token and returns the preview', async () => {
    const preview = { endpoint: { method: 'POST', url: 'https://x/***456/returns', sandbox: true }, body: { periodKey: '26A1' }, headers: {} };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: preview }));
    expect(await previewVatReturn('tok', period, fetchMock)).toEqual(preview);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/vat/preview');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['x-stf-device-id']).toBeTruthy();
    expect(JSON.parse(init.body)).toEqual(period);
  });

  it('throws with the server code when the preview fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, code: 'NOT_CONNECTED', error: 'Connect HMRC' }, 409));
    await expect(previewVatReturn('tok', period, fetchMock)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await expect(previewVatReturn('tok', period, fetchMock)).rejects.toBeInstanceOf(SubmitVatError);
  });
});
