import { invoiceTotals, type Totals } from './invoiceMaths.js';
import type { VatRate } from './vat.js';

export interface InvoiceFormLine {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRatePercent: VatRate;
}

export interface InvoiceFormState {
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  issueDate: string;
  dueDate: string;
  notes: string;
  lines: InvoiceFormLine[];
}

export interface DraftInvoiceRequest {
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  issueDate: string;
  dueDate: string;
  notes: string;
  lines: Array<{ description: string; quantity: number; unitPricePence: number; vatRatePercent: VatRate }>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Quantity is held x10000 (1.5 = 15000); string maths keeps floats out. Null for zero or malformed input. */
export function parseQuantityScaled(input: string): number | null {
  const match = /^(\d{1,4})(?:\.(\d{1,4}))?$/.exec(input.trim());
  if (!match) return null;
  const scaled = Number(match[1]) * 10_000 + Number((match[2] ?? '').padEnd(4, '0'));
  return scaled > 0 ? scaled : null;
}

const MAX_UNIT_PRICE_PENCE = 10_000_000; // matches the server cap in api/_lib/invoices.ts

/** Pounds with at most two decimals to integer pence, up to the server's cap. */
export function parseUnitPricePence(input: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.replace(/[£,\s]/g, ''));
  if (!match) return null;
  const pence = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return pence <= MAX_UNIT_PRICE_PENCE ? pence : null;
}

function parsedLines(form: InvoiceFormState) {
  return form.lines.map((line) => ({
    description: line.description.trim(),
    quantity: parseQuantityScaled(line.quantity),
    unitPricePence: parseUnitPricePence(line.unitPrice),
    vatRatePercent: line.vatRatePercent,
  }));
}

/** Live preview with the same maths the server runs; lines still being typed are left out. */
export function formTotals(form: InvoiceFormState, ownerHasVatNumber: boolean): Totals {
  const ready = parsedLines(form).flatMap((line) =>
    line.quantity === null || line.unitPricePence === null
      ? []
      : [{ quantityScaled: line.quantity, unitPricePence: line.unitPricePence, vatRate: line.vatRatePercent }],
  );
  return invoiceTotals(ready, ownerHasVatNumber);
}

export function toDraftRequest(form: InvoiceFormState): { body: DraftInvoiceRequest | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!form.clientName.trim()) errors.clientName = 'Enter the client name';
  if (!ISO_DATE.test(form.issueDate)) errors.issueDate = 'Enter the issue date';
  if (!ISO_DATE.test(form.dueDate)) errors.dueDate = 'Enter the due date';
  else if (form.dueDate < form.issueDate) errors.dueDate = 'Due date cannot be before the issue date';
  const lines = parsedLines(form);
  const valid = lines.flatMap((line) =>
    line.description && line.quantity !== null && line.unitPricePence !== null
      ? [{ description: line.description, quantity: line.quantity, unitPricePence: line.unitPricePence, vatRatePercent: line.vatRatePercent }]
      : [],
  );
  if (valid.length === 0 || valid.length !== lines.length) {
    errors.lines = 'Each line needs a description, a quantity above zero and a unit price up to £100,000';
  }
  if (Object.keys(errors).length > 0) return { body: null, errors };
  return {
    body: {
      clientName: form.clientName.trim(),
      clientEmail: form.clientEmail.trim(),
      clientAddress: form.clientAddress.trim(),
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      notes: form.notes.trim(),
      lines: valid,
    },
    errors,
  };
}

export function formatQuantity(scaled: number): string {
  const whole = Math.floor(scaled / 10_000);
  const fraction = String(scaled % 10_000).padStart(4, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
