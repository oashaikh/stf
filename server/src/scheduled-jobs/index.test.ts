import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { scheduledJobs, startScheduledJobs } from './index';

describe('startScheduledJobs', () => {
  afterEach(() => {
    vi.useRealTimers();
    scheduledJobs.length = 0;
  });

  it('runs registered jobs on their interval and stops them when the app closes', async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const app = Fastify();
    scheduledJobs.push({ name: 'test-job', intervalMs: 1000, run });

    startScheduledJobs(app);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3000);
    expect(run).toHaveBeenCalledTimes(3);

    await app.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(3000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
