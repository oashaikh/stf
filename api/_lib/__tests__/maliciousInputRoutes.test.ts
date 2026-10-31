import { describe, expect, it } from 'vitest';
import { validateNewAccount } from '../accounts';
import { businessProfileSchema } from '../businessProfile';
import { decodeInvoiceCursor, draftInvoiceSchema, invoiceListQuerySchema, voidInvoiceSchema } from '../invoices';
import { decodeCursor, entryListQuerySchema, newEntrySchema } from '../entries';
import { buildCsv, parseExportRange } from '../entriesExport';
import { validateNewTrip } from '../mileage';
import { newTemplateSchema } from '../recurringEntries';
import { taxIdentifiersSchema } from '../taxIdentifiers';
import { taxYearQuerySchema, tradingAllowanceChoiceSchema } from '../tradingAllowance';
import { normaliseVatNumber } from '../vatNumber';
import { createLoginThrottle } from '../loginThrottle';
import { createLoginHandler } from '../../auth/login';
import { INERT_TEXT, NOT_A_FORMAT, REJECTED_TEXT } from './maliciousInputs';

const UUID = '11111111-1111-4111-8111-111111111111';
const entryBase = { date: '2026-05-01', description: 'Coffee', kind: 'expense', categoryAccountId: UUID, amountPence: 450, amountIs: 'gross' };
const line = { description: 'Work', quantity: 10_000, unitPricePence: 5000, vatRatePercent: 20 };
const invoiceBase = { clientName: 'Client', issueDate: '2026-05-01', dueDate: '2026-05-30', lines: [line] };
const profileBase = { businessName: null, businessAddress: null, paymentBankName: null, paymentSortCode: null, paymentAccountNumber: null, invoicePrefix: 'INV-', nextInvoiceNumber: 1 };
const tripBase = { date: '2026-05-01', from: 'Home', to: 'Client', purpose: 'Visit', distanceTenths: 100, vehicleType: 'car' };
const templateBase = { kind: 'expense', categoryAccountId: UUID, amountPence: 450, amountIs: 'gross', description: 'Rent', schedule: 'monthly', nextDate: '2026-06-01' };
const accountBase = { code: '5000', name: 'Travel', accountType: 'expense' };

type Case = { name: string; accepts: (value: string) => boolean };
const freeText: Case[] = [
  { name: 'entry description', accepts: (v) => newEntrySchema.safeParse({ ...entryBase, description: v }).success },
  { name: 'entry reference', accepts: (v) => newEntrySchema.safeParse({ ...entryBase, reference: v }).success },
  { name: 'entry list search', accepts: (v) => entryListQuerySchema.safeParse({ search: v }).success },
  { name: 'invoice client name', accepts: (v) => draftInvoiceSchema.safeParse({ ...invoiceBase, clientName: v }).success },
  { name: 'invoice client email', accepts: (v) => draftInvoiceSchema.safeParse({ ...invoiceBase, clientEmail: v }).success },
  { name: 'invoice line description', accepts: (v) => draftInvoiceSchema.safeParse({ ...invoiceBase, lines: [{ ...line, description: v }] }).success },
  { name: 'invoice void reason', accepts: (v) => voidInvoiceSchema.safeParse({ reason: v }).success },
  { name: 'account name', accepts: (v) => validateNewAccount({ ...accountBase, name: v }) !== null },
  { name: 'mileage purpose', accepts: (v) => validateNewTrip({ ...tripBase, purpose: v }) !== null },
  { name: 'mileage from', accepts: (v) => validateNewTrip({ ...tripBase, from: v }) !== null },
  { name: 'recurring description', accepts: (v) => newTemplateSchema.safeParse({ ...templateBase, description: v }).success },
  { name: 'business name', accepts: (v) => businessProfileSchema.safeParse({ ...profileBase, businessName: v }).success },
  { name: 'business address', accepts: (v) => businessProfileSchema.safeParse({ ...profileBase, businessAddress: v }).success },
  { name: 'invoice prefix', accepts: (v) => businessProfileSchema.safeParse({ ...profileBase, invoicePrefix: v }).success },
];

const formatBound: Case[] = [
  { name: 'entry date', accepts: (v) => newEntrySchema.safeParse({ ...entryBase, date: v }).success },
  { name: 'entry category id', accepts: (v) => newEntrySchema.safeParse({ ...entryBase, categoryAccountId: v }).success },
  { name: 'entry kind', accepts: (v) => newEntrySchema.safeParse({ ...entryBase, kind: v }).success },
  { name: 'entry list from', accepts: (v) => entryListQuerySchema.safeParse({ from: v }).success },
  { name: 'entry list status', accepts: (v) => entryListQuerySchema.safeParse({ status: v }).success },
  { name: 'entry list limit', accepts: (v) => entryListQuerySchema.safeParse({ limit: v }).success },
  { name: 'entry list min amount', accepts: (v) => entryListQuerySchema.safeParse({ minAmountPence: v }).success },
  { name: 'entry list cursor', accepts: (v) => decodeCursor(v) !== undefined },
  { name: 'invoice list cursor', accepts: (v) => decodeInvoiceCursor(v) !== undefined },
  { name: 'invoice due date', accepts: (v) => draftInvoiceSchema.safeParse({ ...invoiceBase, dueDate: v }).success },
  { name: 'invoice list status', accepts: (v) => invoiceListQuerySchema.safeParse({ status: v }).success },
  { name: 'account code', accepts: (v) => validateNewAccount({ ...accountBase, code: v }) !== null },
  { name: 'account type', accepts: (v) => validateNewAccount({ ...accountBase, accountType: v }) !== null },
  { name: 'account tax category', accepts: (v) => validateNewAccount({ ...accountBase, taxCategory: v }) !== null },
  { name: 'mileage date', accepts: (v) => validateNewTrip({ ...tripBase, date: v }) !== null },
  { name: 'mileage vehicle', accepts: (v) => validateNewTrip({ ...tripBase, vehicleType: v }) !== null },
  { name: 'recurring schedule', accepts: (v) => newTemplateSchema.safeParse({ ...templateBase, schedule: v }).success },
  { name: 'recurring next date', accepts: (v) => newTemplateSchema.safeParse({ ...templateBase, nextDate: v }).success },
  { name: 'sort code', accepts: (v) => businessProfileSchema.safeParse({ ...profileBase, paymentSortCode: v }).success },
  { name: 'account number', accepts: (v) => businessProfileSchema.safeParse({ ...profileBase, paymentAccountNumber: v }).success },
  { name: 'NINO', accepts: (v) => taxIdentifiersSchema.safeParse({ nino: v }).success },
  { name: 'UTR', accepts: (v) => taxIdentifiersSchema.safeParse({ utr: v }).success },
  { name: 'VAT number', accepts: (v) => normaliseVatNumber(v) !== null },
  { name: 'trading allowance tax year', accepts: (v) => taxYearQuerySchema.safeParse({ taxYear: v }).success },
  { name: 'trading allowance method', accepts: (v) => tradingAllowanceChoiceSchema.safeParse({ taxYear: '2025-26', method: v }).success },
  { name: 'export from', accepts: (v) => !('error' in parseExportRange(new URLSearchParams({ from: v, to: '2026-05-01' }))) },
  { name: 'export to', accepts: (v) => !('error' in parseExportRange(new URLSearchParams({ from: '2026-05-01', to: v }))) },
];

describe('free-text inputs', () => {
  it('has the controls working before testing the hostile values', () => {
    for (const { name, accepts } of freeText) expect(accepts('Plain text'), name).toBe(true);
  });

  describe.each(freeText)('$name', ({ accepts }) => {
    it.each(Object.entries(REJECTED_TEXT))('rejects %s', (_label, value) => {
      expect(accepts(value)).toBe(false);
    });
  });

  it('keeps markup, SQL and path text unchanged for display as text', () => {
    for (const value of Object.values(INERT_TEXT)) {
      const parsed = newEntrySchema.parse({ ...entryBase, description: value });
      expect(parsed.description).toBe(value);
    }
  });
});

describe('format-bound inputs', () => {
  it('has the controls working before testing the hostile values', () => {
    const good: Record<string, string> = {
      'entry date': '2026-05-01',
      'entry list from': '2026-05-01',
      'invoice due date': '2026-05-30',
      'account code': '5000',
      'account type': 'expense',
      'mileage date': '2026-05-01',
      'mileage vehicle': 'car',
      'recurring schedule': 'monthly',
      'recurring next date': '2026-06-01',
      'sort code': '123456',
      'account number': '12345678',
      UTR: '1234567890',
      'VAT number': '123456789',
      'trading allowance method': 'allowance',
      'trading allowance tax year': '2025-26',
      'export from': '2026-05-01',
      'export to': '2026-05-01',
    };
    for (const { name, accepts } of formatBound) if (name in good) expect(accepts(good[name]), name).toBe(true);
  });

  describe.each(formatBound)('$name', ({ accepts }) => {
    it.each(NOT_A_FORMAT.map((value, index) => [index, value] as const))('rejects hostile value %i', (_index, value) => {
      expect(accepts(value)).toBe(false);
    });
  });
});

describe('sign-in', () => {
  const handler = createLoginHandler({
    throttle: createLoginThrottle({
      insert: async () => undefined,
      latestSince: async () => [],
      deleteBefore: async () => undefined,
      deleteForClient: async () => undefined,
    }),
    users: { findId: async () => undefined, createIfAbsent: async () => 'owner' },
    totp: { isEnabled: async () => false },
    env: { OWNER_PASSWORD: 'correct-horse', SESSION_SECRET: 'secret-secret-secret' } as NodeJS.ProcessEnv,
    now: () => new Date('2026-10-26T12:00:00Z'),
  } as unknown as Parameters<typeof createLoginHandler>[0]);

  it.each([
    ['10k characters', 'a'.repeat(10_000)],
    ['an empty string', ''],
    ['an object', { $ne: null }],
    ['an array', ['a']],
  ])('answers 400 for a password of %s', async (_label, password) => {
    const response = await handler(new Request('https://x.test/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }));
    expect(response.status).toBe(400);
  });
});

describe('export output', () => {
  it('prefixes formula text so a spreadsheet reads it as text', async () => {
    const lines = [{ date: '2026-05-01', description: INERT_TEXT.formulaPrefix, reference: '+1', accountCode: '5000', accountName: '@x', amountPence: 100, vatPence: 0, status: 'confirmed', source: '-cmd' }];
    const csv = await new Response(buildCsv(lines as Parameters<typeof buildCsv>[0])).text();
    expect(csv).toContain(`"'${INERT_TEXT.formulaPrefix.replace(/"/g, '""')}"`);
    expect(csv).toContain(",'+1,");
    expect(csv).toContain(",'@x,");
    expect(csv).toContain(",'-cmd");
  });
});
