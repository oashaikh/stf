import { describe, expect, it, vi } from 'vitest';
import { describeHmrcStatus, fetchHmrcConnectUrl, fetchHmrcConnected } from '../lib/hmrc/settingsApi';

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe('describeHmrcStatus', () => {
  it('says connected when HMRC is linked', () => {
    expect(describeHmrcStatus(true, null)).toEqual({ label: 'Connected to HMRC', tone: 'connected' });
  });

  it('says not connected when it is not', () => {
    expect(describeHmrcStatus(false, null).label).toBe('Not connected');
  });

  it('reports a failed callback', () => {
    expect(describeHmrcStatus(false, 'error').label).toBe('HMRC connection failed. Please try again.');
  });
});

describe('HMRC api calls', () => {
  it('sends the bearer token to the status route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, connected: true }));
    expect(await fetchHmrcConnected('tok', fetchMock)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/hmrc/status', { headers: { Authorization: 'Bearer tok' } });
  });

  it('returns the authorize url from the connect route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, url: 'https://hmrc.test/auth' }));
    expect(await fetchHmrcConnectUrl('tok', fetchMock)).toBe('https://hmrc.test/auth');
    expect(fetchMock).toHaveBeenCalledWith('/api/hmrc/connect', { headers: { Authorization: 'Bearer tok' } });
  });

  it('throws when the connect route refuses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, false));
    await expect(fetchHmrcConnectUrl('tok', fetchMock)).rejects.toThrow();
  });
});
