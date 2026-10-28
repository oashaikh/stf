// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TAX_BANDS } from '../lib/taxBands';
import { saveExpenseMethod } from '../lib/tradingAllowanceApi';
import TaxPage from './TaxPage';

// The mileage section has its own tests and its own API; this file's fetch mock only knows the tax estimate.
vi.mock('./ItsObligationsSection', () => ({ default: () => <h2>Income Tax obligations</h2> }));
vi.mock('./MileageSection', () => ({ default: () => <h2>Mileage</h2> }));
vi.mock('../lib/tradingAllowanceApi', () => ({ saveExpenseMethod: vi.fn() }));

const estimateFor = (taxYear: string) => ({
  taxYear,
  profitPence: 6000000,
  incomeTaxPence: 800000,
  class2NicPence: 0,
  class4NicPence: 250000,
  totalTaxPence: 1050000,
  setAsidePence: 1050000,
  expenseMethod: 'actual',
  tradingAllowancePence: 100000,
  profitWithActualExpensesPence: 6000000,
  profitWithAllowancePence: 6200000,
  lowerProfitMethod: 'actual',
});

function renderPage(fetchMock: (url: string) => Promise<Response>) {
  const fetchSpy = vi.fn(fetchMock);
  vi.stubGlobal('fetch', fetchSpy);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaxPage />
    </QueryClientProvider>,
  );
  return fetchSpy;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(saveExpenseMethod).mockReset();
});

describe('TaxPage', () => {
  it('uses one content width: the page sets it and no section narrows itself', async () => {
    renderPage(async () => Response.json({ ok: true, data: estimateFor('2026-27') }));
    await screen.findAllByText('£60,000.00');
    const main = screen.getByRole('main');
    expect(main.className).toContain('max-w-4xl');
    expect(main.querySelectorAll('section[class*="max-w-"]')).toHaveLength(0);
  });

  it('renders the Income Tax obligations section', async () => {
    renderPage(async () => Response.json({ ok: true, data: estimateFor('2026-27') }));
    expect(await screen.findByRole('heading', { name: 'Income Tax obligations' })).toBeTruthy();
  });

  it('shows the figures the route returns, the set-aside amount and an estimate note', async () => {
    renderPage(async (url) => Response.json({ ok: true, data: estimateFor(new URL(url, 'https://x').searchParams.get('taxYear')!) }));
    expect((await screen.findAllByText('£60,000.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('£8,000.00')).toBeTruthy();
    expect(screen.getByText('£2,500.00')).toBeTruthy();
    expect(screen.getByText('Nothing to pay')).toBeTruthy();
    expect(screen.getAllByText('£10,500.00')).toHaveLength(2);
    expect(screen.getByText(/this is an estimate/i)).toBeTruthy();
  });

  it('offers exactly the tax years in the bands file and asks the route for the chosen one', async () => {
    const fetchMock = renderPage(async (url) => Response.json({ ok: true, data: estimateFor(new URL(url, 'https://x').searchParams.get('taxYear')!) }));
    await screen.findAllByText('£60,000.00');
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect([...options].sort()).toEqual(Object.keys(TAX_BANDS).sort());
    fireEvent.change(screen.getByLabelText('Tax year'), { target: { value: '2024-25' } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tax-estimate?taxYear=2024-25', { credentials: 'same-origin' }));
  });

  it('shows an error when the estimate cannot be loaded', async () => {
    renderPage(async () => new Response('nope', { status: 500 }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load the tax estimate/i);
  });

  it('shows both profits, which is lower, and the no-expenses warning', async () => {
    renderPage(async (url) => Response.json({ ok: true, data: estimateFor(new URL(url, 'https://x').searchParams.get('taxYear')!) }));
    expect(await screen.findByText('£62,000.00')).toBeTruthy();
    expect(screen.getAllByText('£60,000.00').length).toBeGreaterThan(1);
    expect(screen.getByText('Actual expenses gives the lower profit.')).toBeTruthy();
    expect(screen.getByText(/cannot deduct any expenses/i)).toBeTruthy();
  });

  it('saves the chosen method and reloads the estimate', async () => {
    vi.mocked(saveExpenseMethod).mockResolvedValue('allowance');
    const fetchMock = renderPage(async (url) => Response.json({ ok: true, data: estimateFor(new URL(url, 'https://x').searchParams.get('taxYear')!) }));
    fireEvent.click(await screen.findByLabelText('Trading allowance'));
    await vi.waitFor(() => expect(saveExpenseMethod).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), 'allowance'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('shows an error when saving the choice fails', async () => {
    vi.mocked(saveExpenseMethod).mockRejectedValue(new Error('boom'));
    renderPage(async (url) => Response.json({ ok: true, data: estimateFor(new URL(url, 'https://x').searchParams.get('taxYear')!) }));
    fireEvent.click(await screen.findByLabelText('Trading allowance'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not save your choice/i);
  });
});
