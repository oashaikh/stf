import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { databaseVatNumberStore, maskVatNumber, normaliseVatNumber, type VatNumberStore } from '../_lib/vatNumber.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

export function createVatNumberHandler(store: VatNumberStore = databaseVatNumberStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const vatNumber = normaliseVatNumber(body?.vatNumber);
      if (!vatNumber) return refuse(400, 'VAT number must be 9 digits', 'BAD_REQUEST');
      // A live filing in flight was made under the old number.
      if (await store.hasPendingLiveSubmission(auth.userId)) {
        return refuse(409, 'A live VAT submission is pending', 'SUBMISSION_PENDING');
      }
      await store.set(auth.userId, vatNumber);
    } else if (request.method !== 'GET') {
      return refuse(405, 'Method not allowed', 'METHOD');
    }

    const saved = await store.get(auth.userId);
    if (saved === undefined) return refuse(404, 'User not found', 'NOT_FOUND');
    return Response.json({ ok: true, masked: saved ? maskVatNumber(saved) : null });
  }, authDeps);
}

export default { fetch: createVatNumberHandler() };
