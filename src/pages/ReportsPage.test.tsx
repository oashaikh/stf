// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { profitAndLossPresets } from '../lib/profitAndLoss';
import ReportsPage from './ReportsPage';

const report = {
  start: '2026-04-06',
  end: '2027-04-05',
  income: [{ accountId: 'inc1', accountName: 'Sales', totalPence: 150000 }],
  expenses: [{ accountId: 'exp1', accountName: 'Travel', totalPence: 40050 }],
  incomePence: 150000,
  expensesPence: 40050,
  profitPence: 109950,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: report })));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const requestedUrls = () => fetchMock.mock.calls.map((call) => String(call[0]));

describe('ReportsPage', () => {
  it('shows income, expenses and net profit in pounds', async () => {
    // Each category has one row and one total, and a single-category report shows the amount in both.
    expect(await screen.findAllByText('£1,500.00', { selector: 'dd' })).toHaveLength(2);
    expect(screen.getAllByText('£400.50', { selector: 'dd' })).toHaveLength(2);
    expect(screen.getByText('£1,099.50')).toBeTruthy();
  });

  it('links each category to the expenses list for that category and range', async () => {
    const link = await screen.findByRole('link', { name: 'Travel' });
    expect(link.getAttribute('href')).toBe('/expenses?from=2026-04-06&to=2027-04-05&categoryAccountId=exp1');
  });

  it('requests the range of the chosen preset', async () => {
    await screen.findByText('Sales');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'last-tax-year' } });
    const { start, end } = profitAndLossPresets(new Date())['last-tax-year'];
    await waitFor(() => expect(requestedUrls()).toContain(`/api/profit-and-loss?start=${start}&end=${end}`));
  });

  it('requests a custom range and refuses a reversed one', async () => {
    await screen.findByText('Sales');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-06-30' } });
    await waitFor(() => expect(requestedUrls()).toContain('/api/profit-and-loss?start=2026-06-01&end=2026-06-30'));

    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-05-01' } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('downloads the CSV with amounts in pounds', async () => {
    let csv = '';
    URL.createObjectURL = vi.fn((blob: Blob) => {
      void blob.text().then((text) => (csv = text));
      return 'blob:report';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));
    expect(click).toHaveBeenCalled();
    await waitFor(() => expect(csv).toContain('Expenses,Travel,400.50'));
    expect(csv).toContain('Profit,Net profit,1099.50');
  });
});
