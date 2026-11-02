import { withAuth, type AuthDeps } from './_lib/auth.js';
import { databaseEntryStore, EntryRuleError, type EntryStore } from './_lib/entries.js';
import { confirmReceipt, confirmReceiptSchema, databaseReceiptConfirmStore, discardReceipt, type ReceiptConfirmStore } from './_lib/receiptConfirm.js';
import { validateReceiptId } from './_lib/receipts.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

export interface ConfirmHandlerDeps {
  store?: ReceiptConfirmStore;
  entryStore?: EntryStore;
  now?: () => Date;
}

// POST turns the owner's checked values into an expense; DELETE discards the draft and leaves the receipt for manual entry.
export function createReceiptConfirmHandler({ store = databaseReceiptConfirmStore, entryStore = databaseEntryStore, now = () => new Date() }: ConfirmHandlerDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST' && request.method !== 'DELETE') return refuse(405, 'Method not allowed', 'METHOD');
    const body = await request.json().catch(() => null);
    try {
      if (request.method === 'DELETE') {
        const id = validateReceiptId(body);
        if (!id) return refuse(400, 'Receipt id must be a uuid', 'BAD_REQUEST');
        await discardReceipt(store, auth.userId, id);
        return Response.json({ ok: true });
      }
      const input = confirmReceiptSchema.safeParse(body);
      if (!input.success) return refuse(400, 'Check the date, supplier, amount, VAT rate, category and description', 'BAD_REQUEST');
      const entry = await confirmReceipt(store, entryStore, auth.userId, input.data, now());
      return Response.json({ ok: true, entry: { id: entry.id } });
    } catch (error) {
      if (error instanceof EntryRuleError) return refuse(error.status, error.message, error.code);
      throw error;
    }
  }, authDeps);
}

export default { fetch: createReceiptConfirmHandler() };
