import type { FastifyInstance } from 'fastify';

import { refreshHmrcTokensJob } from './refreshHmrcTokens';

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => void | Promise<void>;
}

export const scheduledJobs: ScheduledJob[] = [refreshHmrcTokensJob];

export function startScheduledJobs(app: FastifyInstance): void {
  const timers = scheduledJobs.map((job) =>
    setInterval(() => {
      // A failed run must not kill the process or stop later runs.
      Promise.resolve(job.run()).catch((error: unknown) => {
        app.log.error({ job: job.name, err: error instanceof Error ? error.message : 'unknown' }, 'scheduled job failed');
      });
    }, job.intervalMs),
  );
  // Timers would otherwise keep firing after shutdown.
  app.addHook('onClose', async () => {
    timers.forEach(clearInterval);
  });
}
