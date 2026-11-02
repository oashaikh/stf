// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAccounts } from '../lib/accountsApi';
import { createDraftFromLine, dismissLine, fetchReconcile, matchLine, undismissLine, unmatchLine } from '../lib/bankReconcileApi';
import BankSortSection from './BankSortSection';

vi.mock('../lib/bankReconcileApi');
vi.mock('../lib/accountsApi', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/accountsApi')>()), fetchAccounts: vi.fn() }));

const line = { id: 'l1', date: '2026-10-03', amountPence: -1250, description: 'COFFEE SUPPLIES' };
const withLine = (kind: 'exact' | 'close' | null) => ({
  lines: [line],
  proposals: kind ? [{ lineId: 'l1', entryId: 'e1', kind, entryDescription: 'Coffee beans', entryDate: '2026-10-03' }] : [],
});

function renderSection() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BankSortSection />
    </QueryClientProvider>,
  );
}

describe('BankSortSection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchAccounts).mockResolvedValue([
      { id: 'a-exp', code: '5000', name: 'Travel', accountType: 'expense', taxCategory: 'travel', isSystem: false },
      { id: 'a-inc', code: '4000', name: 'Sales', accountType: 'income', taxCategory: 'turnover', isSystem: false },
    ]);
    vi.mocked(matchLine).mockResolvedValue(undefined);
    vi.mocked(unmatchLine).mockResolvedValue(undefined);
    vi.mocked(dismissLine).mockResolvedValue(undefined);
    vi.mocked(undismissLine).mockResolvedValue(undefined);
    vi.mocked(createDraftFromLine).mockResolvedValue('e9');
  });
  afterEach(cleanup);

  it('shows a suggested match with its reason, and matches in one tap', async () => {
    vi.mocked(fetchReconcile).mockResolvedValue(withLine('exact'));
    renderSection();
    expect(await screen.findByText('Coffee beans')).toBeInTheDocument();
    expect(screen.getByText(/Same amount, same day/)).toBeInTheDocument();
    expect(screen.getByText('£12.50')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add as new payment' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Yes, match it' }).className).toContain('bg-blue-800');
    fireEvent.click(screen.getByRole('button', { name: 'Yes, match it' }));
    await waitFor(() => expect(matchLine).toHaveBeenCalledTimes(1));
    expect(matchLine).toHaveBeenCalledWith('l1', 'e1');
    await waitFor(() => expect(fetchReconcile).toHaveBeenCalledTimes(2));
  });

  it('says close matches are a few days apart, and hides a suggestion on No', async () => {
    vi.mocked(fetchReconcile).mockResolvedValue(withLine('close'));
    renderSection();
    expect(await screen.findByText(/Same amount, a few days apart/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.queryByRole('button', { name: 'Yes, match it' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add as new payment' })).toBeInTheDocument();
    expect(matchLine).not.toHaveBeenCalled();
  });

  it('undoes a match', async () => {
    vi.mocked(fetchReconcile).mockResolvedValue(withLine('exact'));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, match it' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(unmatchLine).toHaveBeenCalledWith('l1'));
  });

  it('sets a payment aside with a reason, and undoes it', async () => {
    vi.mocked(fetchReconcile).mockResolvedValue(withLine(null));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Set aside' }));
    fireEvent.change(screen.getByLabelText('Why are you setting it aside?'), { target: { value: 'Personal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm set aside' }));
    await waitFor(() => expect(dismissLine).toHaveBeenCalledTimes(1));
    expect(dismissLine).toHaveBeenCalledWith('l1', 'Personal');
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(undismissLine).toHaveBeenCalledWith('l1'));
  });

  it('adds a payment as a new draft using an expense category for money out', async () => {
    vi.mocked(fetchReconcile).mockResolvedValue(withLine(null));
    renderSection();
    await screen.findByText('COFFEE SUPPLIES');
    await screen.findByRole('option', { name: 'Travel' });
    expect(screen.queryByRole('option', { name: 'Sales' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add as new payment' }));
    await waitFor(() => expect(createDraftFromLine).toHaveBeenCalledTimes(1));
    expect(createDraftFromLine).toHaveBeenCalledWith('l1', 'a-exp');
    expect(await screen.findByText(/draft/i)).toBeInTheDocument();
  });

  it('shows the all-sorted state when nothing is left', async () => {
    vi.mocked(fetchReconcile).mockResolvedValue({ lines: [], proposals: [] });
    renderSection();
    expect(await screen.findByText(/all sorted/i)).toBeInTheDocument();
    expect(document.body.textContent?.toLowerCase()).not.toContain('reconcil');
  });

  it('shows an error with a retry when loading fails', async () => {
    vi.mocked(fetchReconcile).mockRejectedValue(new Error('x'));
    renderSection();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows a loading message first', () => {
    vi.mocked(fetchReconcile).mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
