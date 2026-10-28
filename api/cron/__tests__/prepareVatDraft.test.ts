import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { HmrcStore } from '../../_lib/hmrcStore.js';
import { VatReturnError } from '../../_lib/vatReturns.js';
import { createPrepareDraftHandler } from '../prepare-vat-draft';

const SECRET = 'cron-secret-value';
const NOW = new Date('2026-10-27T08:00:00Z');

function request(authorization?: string): Request {
  return new Request('https://stf.example/api/cron/prepare-vat-draft', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

const obligation = (periodKey: string, due: string, status = 'O') => ({
  periodKey,
  start: '2026-07-01',
  end: '2026-09-30',
  due,
  status,
});

function setup({
  obligations = [obligation('26A3', '2026-11-07')],
  vatNumber = '123456789' as string | null,
  connected = true,
  saveDraft = vi.fn().mockResolvedValue(undefined),
} = {}) {
  const store = {
    credentials: vi.fn().mockResolvedValue(
      connected
        ? {
            vatNumber,
            accessToken: 'access',
            refreshToken: 'refresh',
            storedRefreshToken: 'stored',
            // withHmrcToken compares against the real clock, so keep the token valid far ahead of it.
            expiresAt: new Date('2099-01-01T00:00:00Z'),
          }
        : undefined,
    ),
    saveRefreshedTokens: vi.fn(),
  } as unknown as HmrcStore;
  const fetchFn = vi.fn().mockResolvedValue(Response.json({ obligations }));
  const handler = createPrepareDraftHandler({
    cronSecret: SECRET,
    users: { findId: vi.fn().mockResolvedValue('user-1') },
    store,
    saveDraft,
    fetchFn: fetchFn as unknown as typeof fetch,
    now: () => NOW,
  });
  return { handler, saveDraft, fetchFn };
}

const authorised = () => request(`Bearer ${SECRET}`);

describe('prepare-vat-draft cron route', () => {
  it('refuses a missing or wrong secret without doing any work', async () => {
    const { handler, saveDraft, fetchFn } = setup();
    expect((await handler(request())).status).toBe(401);
    expect((await handler(request('Bearer wrong-secret-value'))).status).toBe(401);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses every request when CRON_SECRET is unset', async () => {
    const saveDraft = vi.fn();
    for (const cronSecret of [undefined, '']) {
      const handler = createPrepareDraftHandler({ cronSecret, saveDraft });
      expect((await handler(request('Bearer undefined'))).status).toBe(401);
    }
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('saves a draft once for the obligation due inside the window', async () => {
    const { handler, saveDraft } = setup();
    const response = await handler(authorised());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, saved: true });
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith('user-1', { periodKey: '26A3', start: '2026-07-01', end: '2026-09-30' });
  });

  it('saves nothing when the next obligation is beyond the window', async () => {
    const { handler, saveDraft } = setup({ obligations: [obligation('26A3', '2027-01-07')] });
    const response = await handler(authorised());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: false, reason: 'no_obligation_due' });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('saves nothing when HMRC is not connected', async () => {
    const { handler, saveDraft, fetchFn } = setup({ connected: false });
    const response = await handler(authorised());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: false, reason: 'hmrc_not_connected' });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('saves nothing when no VAT number is set', async () => {
    const { handler, saveDraft, fetchFn } = setup({ vatNumber: null });
    const response = await handler(authorised());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: false, reason: 'vat_number_missing' });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('leaves a confirmed draft alone and still answers 2xx', async () => {
    const saveDraft = vi.fn().mockRejectedValue(new VatReturnError(409, 'ALREADY_CONFIRMED', 'confirmed'));
    const { handler } = setup({ saveDraft });
    const response = await handler(authorised());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: false, reason: 'already_confirmed' });
  });

  it('answers a generic 500 and logs only the error class when the run throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const saveDraft = vi.fn().mockRejectedValue(new TypeError('token abc123 leaked'));
    const { handler } = setup({ saveDraft });
    const response = await handler(authorised());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('abc123');
    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain('abc123');
    log.mockRestore();
  });

  it('has no path to submit: the route source never mentions the submit code', () => {
    const source = readFileSync(new URL('../prepare-vat-draft.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/vatSubmit|submitVatReturn|vat\/submit|submit/i);
  });
});
