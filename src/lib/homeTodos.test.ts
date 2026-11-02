import { describe, expect, it } from 'vitest';
import { buildHomeTodos, type HomeTodoInput } from './homeTodos';
import type { ItsObligationRow } from './hmrc/itsObligationsApi';
import type { VatObligationRow } from './hmrc/vatApi';

const today = new Date('2026-11-02T10:00:00Z');

const vat = (due: string): VatObligationRow => ({
  periodKey: 'A', start: '2026-08-01', end: '2026-10-31', due, status: 'O', overdue: false,
});
const its = (dueDate: string): ItsObligationRow => ({
  kind: 'quarterly', taxYear: '2026-27', periodStart: '2026-04-06', periodEnd: '2026-07-05',
  dueDate, status: 'open', receivedDate: null, overdue: false, nextDue: false,
});
const input = (overrides: Partial<HomeTodoInput> = {}): HomeTodoInput => ({
  vatObligations: [], itsObligations: [], unsortedBankCount: 0, receiptsToCheckCount: 0, bank: null, ...overrides,
});

describe('buildHomeTodos', () => {
  it('puts overdue first, most late first, then soonest, then undated', () => {
    const { items } = buildHomeTodos(
      input({
        vatObligations: [vat('2026-11-20'), vat('2026-10-30')],
        itsObligations: [its('2026-11-10'), its('2026-10-01')],
        unsortedBankCount: 3,
        receiptsToCheckCount: 2,
      }),
      today,
    );
    expect(items.map((item) => item.dueDate ?? item.id)).toEqual([
      '2026-10-01', '2026-10-30', '2026-11-10', '2026-11-20', 'unsorted-payments', 'receipts-to-check',
    ]);
  });

  it('says how late an overdue item is, singular and plural', () => {
    const { items } = buildHomeTodos(input({ vatObligations: [vat('2026-11-01'), vat('2026-10-30')] }), today);
    expect(items[0]).toMatchObject({ daysLate: 3, title: 'File your VAT return, 3 days late' });
    expect(items[1]).toMatchObject({ daysLate: 1, title: 'File your VAT return, 1 day late' });
  });

  it('words dated and undated items in plain words with their targets', () => {
    const { items } = buildHomeTodos(
      input({ vatObligations: [vat('2026-11-20')], itsObligations: [its('2026-11-05')], unsortedBankCount: 1, receiptsToCheckCount: 9 }),
      today,
    );
    expect(items.map((item) => [item.title, item.route])).toEqual([
      ['Send your Income Tax update, due 5 November', '/tax/update/2026-27/1'],
      ['File your VAT return, due 20 November', '/tax/vat'],
      ['Sort 1 bank payment', '/bank'],
      ['Check 9 receipts', '/money-out/receipts'],
    ]);
  });

  it('shows the bank connection item when expiring but not when active', () => {
    const expiring = buildHomeTodos(input({ bank: { state: 'expiring', expiresAt: '2026-11-08T10:00:00Z' } }), today);
    expect(expiring.items).toHaveLength(1);
    expect(expiring.items[0]).toMatchObject({ title: 'Your bank connection runs out in 6 days', route: '/bank' });
    const active = buildHomeTodos(input({ bank: { state: 'active', expiresAt: '2027-02-01T10:00:00Z' } }), today);
    expect(active.items).toHaveLength(0);
  });

  it('lists skipped setup steps after dated items', () => {
    const { items } = buildHomeTodos(
      input({ vatObligations: [vat('2026-11-20')], skippedSetupSteps: [{ id: 'setup-bank', title: 'Connect your bank', route: '/bank' }] }),
      today,
    );
    expect(items.map((item) => item.id)).toEqual(['vat-A', 'setup-bank']);
  });

  it('says you are up to date with the next VAT or Income Tax date', () => {
    const result = buildHomeTodos(input({ vatObligations: [vat('2027-03-07')], itsObligations: [its('2027-05-05')] }), today);
    expect(result.items).toEqual([]);
    expect(result.upToDate).toBe("You're up to date. Your next VAT return is due 7 March.");
    const incomeTax = buildHomeTodos(input({ itsObligations: [its('2027-02-05')] }), today);
    expect(incomeTax.upToDate).toBe("You're up to date. Your next Income Tax update is due 5 February.");
  });

  it('says only that you are up to date when no dates are known', () => {
    expect(buildHomeTodos(input(), today).upToDate).toBe("You're up to date.");
  });

  it('has no up-to-date message when there is something to do', () => {
    expect(buildHomeTodos(input({ unsortedBankCount: 2 }), today).upToDate).toBeNull();
  });

  it('ignores fulfilled obligations and keeps jargon out of titles', () => {
    const fulfilled = { ...its('2026-10-01'), status: 'fulfilled' as const };
    const { items } = buildHomeTodos(
      input({ itsObligations: [fulfilled, its('2026-11-05')], vatObligations: [{ ...vat('2026-10-01'), status: 'F' }, vat('2026-11-07')], unsortedBankCount: 2, receiptsToCheckCount: 2 }),
      today,
    );
    expect(items).toHaveLength(4);
    for (const item of items) expect(item.title).not.toMatch(/obligation|reconcile|box \d/i);
  });
});
