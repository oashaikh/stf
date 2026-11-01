// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import VatFigures, { type DrillLine } from './VatFigures';

const zero = { box1: 0, box2: 0, box3: 0, box4: 0, box5: 0, box6: 0, box7: 0, box8: 0, box9: 0 };
const noLines = Object.fromEntries(Object.keys(zero).map((box) => [box, []])) as unknown as Record<keyof typeof zero, DrillLine[]>;

const line: DrillLine = {
  lineId: 'l1',
  transactionId: 't1',
  date: '2026-09-04',
  amountPence: 10000,
  vatPence: 2000,
  description: 'Invoice 7',
};

function renderFigures(overrides: Partial<Parameters<typeof VatFigures>[0]> = {}) {
  return render(
    <MemoryRouter>
      <VatFigures boxes={zero} drillDown={noLines} drillDownTotals={zero} {...overrides} />
    </MemoryRouter>,
  );
}

const figure = (name: string) => screen.getByRole('group', { name });

afterEach(cleanup);

describe('VatFigures', () => {
  it('names each amount in plain words with its box number beside it', () => {
    renderFigures({ boxes: { ...zero, box1: 2000 } });
    const sales = figure('VAT you charged on sales');
    expect(within(sales).getByText('Box 1')).toBeInTheDocument();
    expect(within(sales).getByText('£20.00')).toBeInTheDocument();
  });

  it('folds the always-zero boxes 2, 8 and 9 into small text instead of rows', () => {
    renderFigures();
    expect(screen.getAllByRole('group')).toHaveLength(6);
    expect(screen.getByText(/Box 2/, { selector: 'p' })).toHaveTextContent(/Box 8.*Box 9/);
  });

  it('reveals the payments behind an amount and links each to Expenses', () => {
    renderFigures({ boxes: { ...zero, box1: 2000 }, drillDown: { ...noLines, box1: [line] }, drillDownTotals: { ...zero, box1: 1 } });
    const sales = figure('VAT you charged on sales');
    const why = within(sales).getByRole('button', { name: /Why is this amount/ });
    expect(why).toHaveAttribute('aria-expanded', 'false');
    expect(within(sales).queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(why);
    expect(why).toHaveAttribute('aria-expanded', 'true');
    expect(within(sales).getByRole('link')).toHaveAttribute('href', '/expenses?from=2026-09-04&to=2026-09-04&search=Invoice+7#entry-t1');
    fireEvent.click(why);
    expect(within(sales).queryByRole('link')).not.toBeInTheDocument();
  });

  it('says so when no payments sit behind an amount', () => {
    renderFigures();
    const sales = figure('VAT you charged on sales');
    fireEvent.click(within(sales).getByRole('button', { name: /Why is this amount/ }));
    expect(within(sales).getByText('No payments add up to this amount.')).toBeInTheDocument();
  });

  it('warns when the list is shorter than the total', () => {
    renderFigures({ drillDown: { ...noLines, box1: [line] }, drillDownTotals: { ...zero, box1: 5 } });
    const sales = figure('VAT you charged on sales');
    fireEvent.click(within(sales).getByRole('button', { name: /Why is this amount/ }));
    expect(within(sales).getByText(/Showing the first 1 of 5 payments/)).toBeInTheDocument();
  });

  it('says a negative net amount is a refund due to the user', () => {
    renderFigures({ boxes: { ...zero, box5: -4500 } });
    const net = figure('What you pay HMRC, or they pay you');
    expect(within(net).getByText('£45.00 refund due to you')).toBeInTheDocument();
  });
});
