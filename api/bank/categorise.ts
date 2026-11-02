import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { categoriseLines, databaseCategoriseStore, MAX_LINES_PER_REQUEST, type CategoriseDeps } from '../_lib/bankCategorise.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

const bodySchema = z
  .object({ lineIds: z.array(z.string().uuid()).min(1).max(MAX_LINES_PER_REQUEST) })
  .strict()
  .refine((body) => new Set(body.lineIds).size === body.lineIds.length);

export type CategoriseHandlerDeps = Partial<CategoriseDeps>;

export function createBankCategoriseHandler(overrides: CategoriseHandlerDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return refuse(405, 'Method not allowed', 'METHOD');

    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse(400, `Send between 1 and ${MAX_LINES_PER_REQUEST} different payment ids`, 'BAD_REQUEST');

    const result = await categoriseLines(
      {
        store: overrides.store ?? databaseCategoriseStore,
        // An empty key is never used: the service skips the call when the key is unset.
        client: overrides.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' }),
        now: overrides.now ?? (() => new Date()),
        env: overrides.env ?? process.env,
      },
      auth.userId,
      body.data.lineIds,
    );

    if (result.status === 'not_found') return refuse(404, 'Payment not found', 'NOT_FOUND');
    if (result.status === 'rate_limited') return refuse(429, 'Too many suggestion requests this hour. Sort these by hand or try again later.', 'RATE_LIMITED');
    if (result.status === 'failed') return refuse(502, 'We could not get suggestions just now. You can sort these payments by hand.', 'SUGGESTION_FAILED');

    // Ids, account ids and confidence only: never descriptions or the model reply.
    return Response.json({ ok: true, status: result.status, suggestions: result.suggestions });
  }, authDeps);
}

export default { fetch: createBankCategoriseHandler() };
