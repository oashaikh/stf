// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TAX_BANDS } from '../lib/taxBands';
import TaxPage from './TaxPage';

// The mileage section has its own tests and its own API; this file's fetch mock only knows the tax estimate.
vi.mock('./MileageSection', () => ({ default: () => <h2>Mileage</h2> }));

const estimateFor = (taxYear: string) => ({
  taxYear,
  profitPence: 6000000,
  incomeTaxPence: 800000,
  class2NicPence: 0,
  class4NicPence: 250000,
  totalTaxPence: 1050000,
  setAsidePence: 1050000,
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
});

describe('TaxPage', () => {
  it('shows the figures the route returns, the set-aside amount and an estimate note', async () => {
    renderPage(async (url) => Response.json({ ok: true, data: estimateFor(new URL(url, 'https://x').searchParams.get('taxYear')!) }));
    expect(await screen.findByText('£60,000.00')).toBeTruthy();
    expect(screen.getByText('£8,000.00')).toBeTruthy();
    expect(screen.getByText('£2,500.00')).toBeTruthy();
    expect(screen.getByText('Nothing to pay')).toBeTruthy();
    expect(screen.getAllByText('£10,500.00')).toHaveLength(2);
    expect(screen.getByText(/this is an estimate/i)).toBeTruthy();
  });

  it('offers exactly the tax years in the bands file and asks the route for the chosen one', async () => {
    const fetchMock = renderPage(async (url) => Response.json({ ok: true, data: estimateFor(new URL(url, 'https://x').searchParams.get('taxYear')!) }));
    await screen.findByText('£60,000.00');
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect([...options].sort()).toEqual(Object.keys(TAX_BANDS).sort());
    fireEvent.change(screen.getByLabelText('Tax year'), { target: { value: '2024-25' } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tax-estimate?taxYear=2024-25', { credentials: 'same-origin' }));
  });

  it('shows an error when the estimate cannot be loaded', async () => {
    renderPage(async () => new Response('nope', { status: 500 }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load the tax estimate/i);
  });
});
