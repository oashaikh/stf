import { createHash, timingSafeEqual } from 'node:crypto';

import { importBankTransactions, type BankImportSummary } from '../_lib/bankImport.js';
import { databaseBankImportStore } from '../_lib/bankImportStore.js';
import { createTrueLayerProvider, trueLayerConfigFromEnv } from '../_lib/truelayerProvider.js';

// Hashing first gives equal-length buffers, so timingSafeEqual neither throws nor leaks the secret's length.
function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function createBankImportCronHandler(run: () => Promise<BankImportSummary>, cronSecret: string | undefined) {
  return async (request: Request): Promise<Response> => {
    // Fail closed: with no secret configured nobody is authorised.
    if (!cronSecret) return Response.json({ ok: false }, { status: 401 });
    const presented = request.headers.get('authorization') ?? '';
    if (!timingSafeEqual(sha256(presented), sha256(`Bearer ${cronSecret}`))) {
      return Response.json({ ok: false }, { status: 401 });
    }
    let summary: BankImportSummary;
    try {
      summary = await run();
    } catch (error) {
      // The error class only: the message could echo a token.
      console.error(`[import-bank-transactions] cron run failed: ${error instanceof Error ? error.name : typeof error}`);
      return Response.json({ ok: false }, { status: 500 });
    }
    console.log(`[import-bank-transactions] connections=${summary.connections} imported=${summary.imported} flagged=${summary.flagged} failed=${summary.failed} expired=${summary.expired}`);
    // Non-2xx when every connection failed, so a total outage can be alerted on.
    if (summary.connections > 0 && summary.failed === summary.connections) {
      return Response.json({ ok: false, ...summary }, { status: 500 });
    }
    return Response.json({ ok: true, ...summary });
  };
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; the env var is read per request.
export default {
  fetch: (request: Request) =>
    createBankImportCronHandler(
      () => importBankTransactions(databaseBankImportStore, createTrueLayerProvider(trueLayerConfigFromEnv()), new Date()),
      process.env.CRON_SECRET,
    )(request),
};
