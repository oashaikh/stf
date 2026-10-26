import { createHash, timingSafeEqual } from 'node:crypto';

import { refreshHmrcTokensJob } from '../../server/src/scheduled-jobs/refreshHmrcTokens';

// Hashing first gives equal-length buffers, so timingSafeEqual neither throws nor leaks the secret's length.
function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function createRefreshCronHandler(run: () => void | Promise<void>, cronSecret: string | undefined) {
  return async (request: Request): Promise<Response> => {
    // Fail closed: with no secret configured nobody is authorised.
    if (!cronSecret) return Response.json({ ok: false }, { status: 401 });
    const presented = request.headers.get('authorization') ?? '';
    if (!timingSafeEqual(sha256(presented), sha256(`Bearer ${cronSecret}`))) {
      return Response.json({ ok: false }, { status: 401 });
    }
    try {
      await run();
    } catch {
      // Fixed text only: the error could echo a token.
      console.error('[refresh-hmrc-tokens] cron run failed');
      return Response.json({ ok: false }, { status: 500 });
    }
    return Response.json({ ok: true });
  };
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; the env var is read per request.
export default { fetch: (request: Request) => createRefreshCronHandler(refreshHmrcTokensJob.run, process.env.CRON_SECRET)(request) };
