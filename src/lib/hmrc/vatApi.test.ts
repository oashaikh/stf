// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFiledVatReturn, fetchVatHistory, fetchVatObligations, NotConnectedError, previewVatReturn, SubmitVatError, submitVatReturn, VatNumberMissingError } from './vatApi';

const obligation = { periodKey: '18A1', start: '2026-01-01', end: '2026-03-31', due: '2026-05-07', status: 'O', overdue: false };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

describe('fetchVatObligations', () => {
  beforeEach(() => localStorage.clear());

  it('sends the session cookie and browser fraud headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, obligations: [obligation] }));
    expect(await fetchVatObligations(fetchMock)).toEqual([obligation]);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/vat/obligations');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['x-stf-timezone']).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
    expect(init.headers['x-stf-screens']).toContain('width=');
    expect(init.headers['x-stf-window-size']).toContain('height=');
    expect(init.headers['x-stf-js-user-agent']).toBe(navigator.userAgent);
    expect(init.headers['x-stf-device-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps the same device id across calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, obligations: [] }));
    await fetchVatObligations(fetchMock);
    await fetchVatObligations(fetchMock);
    const ids = fetchMock.mock.calls.map(([, init]) => init.headers['x-stf-device-id']);
    expect(ids[0]).toBe(ids[1]);
    expect(localStorage.getItem('stf-device-id')).toBe(ids[0]);
  });

  it('throws NotConnectedError on 409', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, code: 'HMRC_NOT_CONNECTED' }, 409));
    await expect(fetchVatObligations(fetchMock)).rejects.toBeInstanceOf(NotConnectedError);
  });

  it('throws VatNumberMissingError when the VAT number is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, code: 'VAT_NUMBER_MISSING' }, 409));
    const failure = await fetchVatObligations(fetchMock).catch((error) => error);
    expect(failure).toBeInstanceOf(VatNumberMissingError);
    expect(failure).not.toBeInstanceOf(NotConnectedError);
  });

  it('throws a plain error on other failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 502));
    const failure = await fetchVatObligations(fetchMock).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(NotConnectedError);
  });
});

describe('submitVatReturn', () => {
  const period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };

  it('posts the period with explicit confirmation and fraud headers, and returns the receipt', async () => {
    const receipt = { formBundleNumber: '256 SANDBOX 1', processingDate: '2026-04-02T10:00:00.000Z', sandbox: true };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: receipt }));
    expect(await submitVatReturn(period, fetchMock)).toEqual(receipt);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/vat/submit');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['x-stf-device-id']).toBeTruthy();
    expect(JSON.parse(init.body)).toEqual({ ...period, confirm: true });
  });

  it('throws with the server code when the outcome is unknown', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, code: 'OUTCOME_UNKNOWN', error: 'Do not resubmit' }, 502));
    await expect(submitVatReturn(period, fetchMock)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await expect(submitVatReturn(period, fetchMock)).rejects.toBeInstanceOf(SubmitVatError);
  });
});

describe('fetchVatHistory', () => {
  beforeEach(() => localStorage.clear());

  it('sends the session cookie and returns the history items', async () => {
    const item = { periodKey: '26A1', status: 'draft' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: [item] }));
    expect(await fetchVatHistory(fetchMock)).toEqual([item]);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/vat/history');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toBeUndefined();
  });

  it('throws when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 500));
    await expect(fetchVatHistory(fetchMock)).rejects.toThrow('Request to /api/vat/history failed');
  });
});

describe('previewVatReturn', () => {
  beforeEach(() => localStorage.clear());
  const period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };

  it('posts only the period with the session cookie and returns the preview', async () => {
    const preview = { endpoint: { method: 'POST', url: 'https://x/***456/returns', sandbox: true }, body: { periodKey: '26A1' }, headers: {} };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: preview }));
    expect(await previewVatReturn(period, fetchMock)).toEqual(preview);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/vat/preview');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['x-stf-device-id']).toBeTruthy();
    expect(JSON.parse(init.body)).toEqual(period);
  });

  it('throws with the server code when the preview fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, code: 'NOT_CONNECTED', error: 'Connect HMRC' }, 409));
    await expect(previewVatReturn(period, fetchMock)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await expect(previewVatReturn(period, fetchMock)).rejects.toBeInstanceOf(SubmitVatError);
  });
});

describe('fetchFiledVatReturn', () => {
  const filed = {
    vatDueSales: 20.1,
    vatDueAcquisitions: 0,
    totalVatDue: 20.1,
    vatReclaimedCurrPeriod: 0.29,
    netVatDue: 19.81,
    totalValueSalesExVAT: 100,
    totalValuePurchasesExVAT: 50,
    totalValueGoodsSuppliedExVAT: 0,
    totalAcquisitionsExVAT: 0,
  };

  it('maps the nine HMRC fields to integer pence without float drift', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: filed }));
    expect(await fetchFiledVatReturn('#001', fetchMock)).toEqual({
      box1: 2010, box2: 0, box3: 2010, box4: 29, box5: 1981, box6: 10000, box7: 5000, box8: 0, box9: 0,
    });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/vat/filed?periodKey=%23001');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['x-stf-device-id']).toBeTruthy();
  });

  it('throws when the server reports a failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false, code: 'HMRC_NOT_CONNECTED' }, 409));
    await expect(fetchFiledVatReturn('26A1', fetchMock)).rejects.toThrow();
  });
});
