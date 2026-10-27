import { describe, expect, it, vi } from 'vitest';

import { createRecurringCronHandler } from '../create-recurring-entries';

const SECRET = 'cron-secret-value';

function request(authorization?: string): Request {
  return new Request('https://stf.example/api/cron/create-recurring-entries', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe('create-recurring-entries cron route', () => {
  it('refuses missing or wrong secrets, and every request when CRON_SECRET is unset, without running', async () => {
    const run = vi.fn();
    const handler = createRecurringCronHandler(run, SECRET);
    expect((await handler(request())).status).toBe(401);
    expect((await handler(request('Bearer wrong-secret-value'))).status).toBe(401);
    expect((await handler(request('Bearer x'))).status).toBe(401);
    for (const secret of [undefined, '']) {
      expect((await createRecurringCronHandler(run, secret)(request('Bearer '))).status).toBe(401);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('runs once with the correct secret and returns counts', async () => {
    const run = vi.fn().mockResolvedValue({ created: 2, skipped: 1 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await createRecurringCronHandler(run, SECRET)(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, created: 2, skipped: 1 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toBe('[create-recurring-entries] created=2 skipped=1');
    log.mockRestore();
  });

  it('returns 500 when every due date was skipped, but 200 when nothing was due', async () => {
    const handler = (summary: { created: number; skipped: number }) =>
      createRecurringCronHandler(vi.fn().mockResolvedValue(summary), SECRET)(request(`Bearer ${SECRET}`));
    expect((await handler({ created: 0, skipped: 3 })).status).toBe(500);
    expect((await handler({ created: 0, skipped: 0 })).status).toBe(200);
  });

  it('returns a generic 500 and logs only the error class when the run throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await createRecurringCronHandler(vi.fn().mockRejectedValue(new TypeError('rent for Alice leaked')), SECRET)(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('Alice');
    expect(String(log.mock.calls[0]?.[0])).toContain('TypeError');
    expect(String(log.mock.calls[0]?.[0])).not.toContain('Alice');
    log.mockRestore();
  });
});
