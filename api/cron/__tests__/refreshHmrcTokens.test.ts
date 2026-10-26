import { describe, expect, it, vi } from 'vitest';

import { createRefreshCronHandler } from '../refresh-hmrc-tokens';

const SECRET = 'cron-secret-value';

function request(authorization?: string): Request {
  return new Request('https://stf.example/api/cron/refresh-hmrc-tokens', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe('refresh-hmrc-tokens cron route', () => {
  it('refuses a request with no Authorization header and does not refresh', async () => {
    const run = vi.fn();
    const response = await createRefreshCronHandler(run, SECRET)(request());
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret, including one of a different length', async () => {
    const run = vi.fn();
    const handler = createRefreshCronHandler(run, SECRET);
    expect((await handler(request('Bearer wrong-secret-value'))).status).toBe(401);
    expect((await handler(request('Bearer x'))).status).toBe(401);
    expect((await handler(request(SECRET))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses every request when CRON_SECRET is unset', async () => {
    const run = vi.fn();
    for (const secret of [undefined, '']) {
      const handler = createRefreshCronHandler(run, secret);
      expect((await handler(request('Bearer undefined'))).status).toBe(401);
      expect((await handler(request('Bearer '))).status).toBe(401);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the refresh once with the correct secret', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const response = await createRefreshCronHandler(run, SECRET)(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('returns a generic 500 without error text when the refresh throws', async () => {
    const run = vi.fn().mockRejectedValue(new Error('token abc123 leaked'));
    const response = await createRefreshCronHandler(run, SECRET)(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('abc123');
  });
});
