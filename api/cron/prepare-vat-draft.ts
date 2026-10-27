import { createHash, timingSafeEqual } from 'node:crypto';

import { runPrepareVatDraft, type PrepareSummary } from '../../server/src/scheduled-jobs/prepareVatDraft.js';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function createPrepareDraftCronHandler(run: () => Promise<PrepareSummary>, cronSecret: string | undefined) {
  return async (request: Request): Promise<Response> => {
    // Fail closed: with no secret configured nobody is authorised.
    if (!cronSecret) return Response.json({ ok: false }, { status: 401 });
    const presented = request.headers.get('authorization') ?? '';
    if (!timingSafeEqual(sha256(presented), sha256(`Bearer ${cronSecret}`))) {
      return Response.json({ ok: false }, { status: 401 });
    }
    let summary: PrepareSummary;
    try {
      summary = await run();
    } catch (error) {
      // The error class only: the message could echo a token.
      console.error(`[prepare-vat-draft] cron run failed: ${error instanceof Error ? error.name : typeof error}`);
      return Response.json({ ok: false }, { status: 500 });
    }
    if (!summary.attempted) {
      return Response.json({ ok: true, reason: summary.reason });
    }
    console.log(`[prepare-vat-draft] attempted=${summary.attempted} saved=${summary.saved} reason=${summary.reason}`);
    return Response.json({ ok: true, saved: summary.saved, reason: summary.reason });
  };
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; the env var is read per request.
export default { fetch: (request: Request) => createPrepareDraftCronHandler(runPrepareVatDraft, process.env.CRON_SECRET)(request) };
