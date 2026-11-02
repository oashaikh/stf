import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSetupFacts, fetchSetupState, saveSetupAnswers } from './setupApi';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const serverState = { ok: true, businessType: 'sole_trader', vatRegistered: null, skippedSteps: ['bank'], finishedAt: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setupApi', () => {
  it('reads the saved state', async () => {
    const fake = vi.fn().mockResolvedValue(json(serverState));
    vi.stubGlobal('fetch', fake);
    expect(await fetchSetupState()).toEqual({ businessType: 'sole_trader', vatRegistered: null, skippedSteps: ['bank'], finishedAt: null });
    expect(fake).toHaveBeenCalledWith('/api/settings/setup', { credentials: 'same-origin' });
  });

  it('posts answers as JSON and returns the new state', async () => {
    const fake = vi.fn().mockResolvedValue(json({ ...serverState, vatRegistered: true }));
    vi.stubGlobal('fetch', fake);
    const state = await saveSetupAnswers({ vatRegistered: true, finish: true });
    expect(state.vatRegistered).toBe(true);
    const init = fake.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ vatRegistered: true, finish: true });
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: false }, 400)));
    await expect(fetchSetupState()).rejects.toThrow('Setup request failed');
  });

  it('combines saved state with HMRC, bank and VAT number status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/api/settings/setup') return json(serverState);
        if (path === '/api/hmrc/status') return json({ connected: true });
        if (path === '/api/bank/status') return json({ connected: false });
        if (path === '/api/settings/vat-number') return json({ masked: '•••••6789' });
        return json({}, 404);
      }),
    );
    const facts = await fetchSetupFacts();
    expect(facts).toMatchObject({ hmrcConnected: true, bankConnected: false, hasVatNumber: true });
    expect(facts.setup.skippedSteps).toEqual(['bank']);
  });
});
