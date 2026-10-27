import { createHash, timingSafeEqual } from 'node:crypto';

import { databaseEntryStore } from '../_lib/entries.js';
import { databaseRecurringStore, generateDueEntries, type GenerateResult } from '../_lib/recurringEntries.js';

// Hashing first gives equal-length buffers, so timingSafeEqual neither throws nor leaks the secret's length.
function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function createRecurringCronHandler(run: () => Promise<GenerateResult>, cronSecret: string | undefined) {
  return async (request: Request): Promise<Response> => {
    // Fail closed: with no secret configured nobody is authorised.
    if (!cronSecret) return Response.json({ ok: false }, { status: 401 });
    const presented = request.headers.get('authorization') ?? '';
    if (!timingSafeEqual(sha256(presented), sha256(`Bearer ${cronSecret}`))) {
      return Response.json({ ok: false }, { status: 401 });
    }
    let summary: GenerateResult;
    try {
      summary = await run();
    } catch (error) {
      // The error class only: the message could echo a template description.
      console.error(`[create-recurring-entries] cron run failed: ${error instanceof Error ? error.name : typeof error}`);
      return Response.json({ ok: false }, { status: 500 });
    }
    console.log(`[create-recurring-entries] created=${summary.created} skipped=${summary.skipped}`);
    // Non-2xx when every due date was skipped, so a total outage can be alerted on.
    if (summary.created === 0 && summary.skipped > 0) {
      return Response.json({ ok: false, ...summary }, { status: 500 });
    }
    return Response.json({ ok: true, ...summary });
  };
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; the env var is read per request.
export default {
  fetch: (request: Request) =>
    createRecurringCronHandler(() => generateDueEntries(databaseRecurringStore, databaseEntryStore, new Date()), process.env.CRON_SECRET)(request),
};
