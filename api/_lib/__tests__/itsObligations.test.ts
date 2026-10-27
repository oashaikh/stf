import { describe, expect, it } from 'vitest';

import { markItsObligations, normaliseItsObligations, previousTaxYear, type ItsObligation } from '../itsObligations';
import type { ItsFinalDeclarationObligations, ItsIncomeAndExpenditureObligations } from '../../../src/lib/hmrc/client';
import fixtures from '../../../src/lib/hmrc/fixtures/itsObligations.json';

const item = (overrides: Partial<ItsObligation>): ItsObligation => ({
  kind: 'quarterly',
  taxYear: '2026-27',
  periodStart: '2026-07-06',
  periodEnd: '2026-10-05',
  dueDate: '2026-11-07',
  status: 'open',
  receivedDate: null,
  ...overrides,
});

describe('previousTaxYear', () => {
  it('steps back one year, including across a century', () => {
    expect(previousTaxYear('2026-27')).toBe('2025-26');
    expect(previousTaxYear('2000-01')).toBe('1999-00');
  });
});

describe('normaliseItsObligations', () => {
  it('flattens the recorded sandbox responses', () => {
    const result = normaliseItsObligations(
      '2026-27',
      fixtures.incomeAndExpenditure as ItsIncomeAndExpenditureObligations,
      fixtures.finalDeclaration as ItsFinalDeclarationObligations,
    );
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      kind: 'quarterly',
      taxYear: '2026-27',
      periodStart: '2026-04-06',
      periodEnd: '2026-07-05',
      dueDate: '2026-08-07',
      status: 'fulfilled',
      receivedDate: '2026-08-01',
    });
    expect(result[2]).toMatchObject({ kind: 'finalDeclaration', status: 'open', dueDate: '2028-01-31', receivedDate: null });
  });
});

describe('markItsObligations', () => {
  it('flags only the open item with the earliest due date', () => {
    const { obligations, nextDue } = markItsObligations(
      [
        item({ periodStart: '2026-04-06', dueDate: '2026-08-07', status: 'fulfilled' }),
        item({ periodStart: '2027-01-06', dueDate: '2027-02-07' }),
        item({ periodStart: '2026-07-06', dueDate: '2026-11-07' }),
      ],
      '2026-10-26',
    );
    expect(obligations.filter((o) => o.nextDue)).toHaveLength(1);
    expect(nextDue?.dueDate).toBe('2026-11-07');
    expect(obligations.map((o) => o.periodStart)).toEqual(['2026-04-06', '2026-07-06', '2027-01-06']);
  });

  it('breaks a due-date tie by the earlier period start', () => {
    const { nextDue } = markItsObligations(
      [item({ kind: 'finalDeclaration', periodStart: '2026-04-06' }), item({ periodStart: '2026-01-01' })],
      '2026-10-26',
    );
    expect(nextDue?.periodStart).toBe('2026-01-01');
  });

  it('marks an open item overdue only after its due date', () => {
    const open = [item({ dueDate: '2026-11-07' })];
    expect(markItsObligations(open, '2026-11-07').obligations[0].overdue).toBe(false);
    expect(markItsObligations(open, '2026-11-08').obligations[0].overdue).toBe(true);
  });

  it('never marks a fulfilled item overdue or next due, even when it is late', () => {
    const { obligations, nextDue } = markItsObligations([item({ status: 'fulfilled', dueDate: '2026-01-01' })], '2026-10-26');
    expect(obligations[0]).toMatchObject({ overdue: false, nextDue: false });
    expect(nextDue).toBeNull();
  });

  it('lets an overdue open item be the next due one', () => {
    const { nextDue } = markItsObligations([item({ dueDate: '2026-08-07' }), item({ periodStart: '2026-10-06', dueDate: '2027-02-07' })], '2026-10-26');
    expect(nextDue).toMatchObject({ dueDate: '2026-08-07', overdue: true });
  });

  it('returns no next due when nothing is open', () => {
    expect(markItsObligations([], '2026-10-26')).toEqual({ obligations: [], nextDue: null });
  });
});
