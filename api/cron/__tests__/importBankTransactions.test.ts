import { describe, expect, it, vi } from 'vitest';

import { createBankImportCronHandler } from '../import-bank-transactions';

const SECRET = 'test-cron-secret-value';
const summary = { connections: 2, imported: 3, flagged: 1, failed: 0 };

function request(authorization?: string): Request {
  return new Request('https://stf.example/api/cron/import-bank-transactions', { headers: authorization === undefined ? {} : { authorization } });
}

describe('import-bank-transactions cron route', () => {
  it('refuses missing or wrong secrets, and every request when CRON_SECRET is unset, without running', async () => {
    const run = vi.fn();
    expect((await createBankImportCronHandler(run, SECRET)(request())).status).toBe(401);
    expect((await createBankImportCronHandler(run, SECRET)(request('Bearer wrong'))).status).toBe(401);
    expect((await createBankImportCronHandler(run, undefined)(request('Bearer '))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs once with the correct secret and returns the counts', async () => {
    const run = vi.fn().mockResolvedValue(summary);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await createBankImportCronHandler(run, SECRET)(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ...summary });
    expect(run).toHaveBeenCalledOnce();
  });

  it('returns 500 when the run throws or every connection failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const thrown = createBankImportCronHandler(vi.fn().mockRejectedValue(new Error('secret-token')), SECRET);
    expect((await thrown(request(`Bearer ${SECRET}`))).status).toBe(500);
    const allFailed = createBankImportCronHandler(vi.fn().mockResolvedValue({ connections: 1, imported: 0, flagged: 0, failed: 1 }), SECRET);
    expect((await allFailed(request(`Bearer ${SECRET}`))).status).toBe(500);
  });
});
