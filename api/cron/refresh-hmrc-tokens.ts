import { createHash, timingSafeEqual } from 'node:crypto';

import { runHmrcTokenRefresh, type RefreshSummary } from '../../server/src/scheduled-jobs/refreshHmrcTokens.js';

// Hashing first gives equal-length buffers, so timingSafeEqual neither throws nor leaks the secret's length.
function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function createRefreshCronHandler(run: () => Promise<RefreshSummary>, cronSecret: string | undefined) {
  return async (request: Request): Promise<Response> => {
    // Fail closed: with no secret configured nobody is authorised.
    if (!cronSecret) return Response.json({ ok: false }, { status: 401 });
    const presented = request.headers.get('authorization') ?? '';
    if (!timingSafeEqual(sha256(presented), sha256(`Bearer ${cronSecret}`))) {
      return Response.json({ ok: false }, { status: 401 });
    }
    let summary: RefreshSummary;
    try {
      summary = await run();
    } catch (error) {
      // The error class only: the message could echo a token.
      console.error(`[refresh-hmrc-tokens] cron run failed: ${error instanceof Error ? error.name : typeof error}`);
      return Response.json({ ok: false }, { status: 500 });
    }
    console.log(`[refresh-hmrc-tokens] attempted=${summary.attempted} failed=${summary.failed}`);
    // Non-2xx when every attempt failed, so a total outage can be alerted on.
    if (summary.attempted > 0 && summary.failed === summary.attempted) {
      return Response.json({ ok: false }, { status: 500 });
    }
    return Response.json({ ok: true });
  };
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; the env var is read per request.
export default { fetch: (request: Request) => createRefreshCronHandler(runHmrcTokenRefresh, process.env.CRON_SECRET)(request) };
