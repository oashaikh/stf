// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VatHistoryList from './VatHistoryList';
import type { VatHistoryItem } from '../lib/hmrc/vatApi';

const fetchVatHistory = vi.fn();
vi.mock('../lib/hmrc/vatApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hmrc/vatApi')>()),
  fetchVatHistory: (...args: unknown[]) => fetchVatHistory(...args),
}));
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: async () => 'tok' }) }));

function item(periodKey: string, status: VatHistoryItem['status'], box5: number, receipt: VatHistoryItem['receipt'] = null): VatHistoryItem {
  return {
    periodKey,
    start: '2026-01-01',
    end: '2026-03-31',
    status,
    boxes: { box1: 100000, box2: 0, box3: 100000, box4: 25000, box5, box6: 500000, box7: 125000, box8: 0, box9: 0 },
    receipt,
  };
}
const liveReceipt = { formBundleNumber: '256660290587', processingDate: '2026-04-20T10:00:00.000Z', sandbox: false };

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <VatHistoryList />
    </QueryClientProvider>,
  );
}

describe('VatHistoryList', () => {
  afterEach(cleanup);
  beforeEach(() => {
    fetchVatHistory.mockReset();
  });

  it('shows a text status label and formatted net VAT for every status', async () => {
    fetchVatHistory.mockResolvedValue([
      item('26A1', 'draft', 75000),
      item('25D4', 'confirmed', 123456),
      item('25C3', 'submitted', -5000),
      item('25B2', 'accepted', 0, liveReceipt),
    ]);
    renderList();
    const rows = await screen.findAllByRole('row');
    const text = rows.map((row) => row.textContent);
    expect(text.some((t) => t?.includes('26A1') && t.includes('Draft') && t.includes('£750.00'))).toBe(true);
    expect(text.some((t) => t?.includes('25D4') && t.includes('Confirmed') && t.includes('£1,234.56'))).toBe(true);
    expect(text.some((t) => t?.includes('25C3') && t.includes('Submitted') && t.includes('-£50.00'))).toBe(true);
    expect(text.some((t) => t?.includes('25B2') && t.includes('Accepted') && t.includes('£0.00'))).toBe(true);
  });

  it('opens an accepted return read-only with the stored receipt and no action buttons', async () => {
    fetchVatHistory.mockResolvedValue([item('25B2', 'accepted', 75000, liveReceipt)]);
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /25B2/ }));
    const detail = screen.getByRole('region', { name: /Return 25B2/ });
    expect(within(detail).getByText('256660290587')).toBeInTheDocument();
    expect(within(detail).getByText('2026-04-20')).toBeInTheDocument();
    expect(within(detail).getByText(/Box 1: VAT due on sales/)).toBeInTheDocument();
    expect(within(detail).getAllByText(/£/)).toHaveLength(9);
    expect(within(detail).queryByRole('button', { name: /edit|reopen|confirm|submit/i })).toBeNull();
    expect(within(detail).queryByText(/sandbox/i)).toBeNull();
  });

  it('labels a sandbox receipt', async () => {
    fetchVatHistory.mockResolvedValue([item('25B2', 'accepted', 75000, { ...liveReceipt, sandbox: true })]);
    renderList();
    expect(await screen.findByText('Sandbox')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /25B2/ }));
    expect(within(screen.getByRole('region', { name: /Return 25B2/ })).getByText(/Sandbox receipt/)).toBeInTheDocument();
  });

  it('opens a submitted return with no receipt yet, showing boxes and an awaiting note', async () => {
    fetchVatHistory.mockResolvedValue([item('25C3', 'submitted', 75000)]);
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /25C3/ }));
    const detail = screen.getByRole('region', { name: /Return 25C3/ });
    expect(within(detail).getByText(/Box 1: VAT due on sales/)).toBeInTheDocument();
    expect(within(detail).getAllByText(/£/)).toHaveLength(9);
    expect(within(detail).getByText(/awaiting HMRC confirmation/i)).toBeInTheDocument();
    expect(within(detail).queryByText(/form bundle number/i)).toBeNull();
  });

  it('does not open a draft', async () => {
    fetchVatHistory.mockResolvedValue([item('26A1', 'draft', 1)]);
    renderList();
    await screen.findByText('26A1');
    expect(screen.queryByRole('button', { name: /26A1/ })).toBeNull();
  });

  it('shows loading then the empty state', async () => {
    fetchVatHistory.mockResolvedValue([]);
    renderList();
    expect(screen.getByRole('status')).toHaveTextContent(/Loading/);
    expect(await screen.findByText('No past VAT returns yet.')).toBeInTheDocument();
  });

  it('shows an error state when the request fails', async () => {
    fetchVatHistory.mockImplementation(async () => {
      throw new Error('boom');
    });
    renderList();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load/);
  });
});
