// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { fetchAccounts, type ApiAccount } from '../lib/accountsApi';
import { confirmReceiptDraft, discardReceiptDraft, type ListedReceipt } from '../lib/receiptsApi';
import ReceiptReview from './ReceiptReview';

vi.mock('../lib/accountsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/accountsApi')>()),
  fetchAccounts: vi.fn(),
}));
vi.mock('../lib/receiptsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/receiptsApi')>()),
  confirmReceiptDraft: vi.fn(),
  discardReceiptDraft: vi.fn(),
}));

const account = (id: string, name: string, accountType: ApiAccount['accountType'], taxCategory: string | null = null): ApiAccount => ({
  id, code: id, name, accountType, taxCategory, isSystem: false,
});
const accounts = [
  account('acc-travel', 'Travel', 'expense', 'travel'),
  account('acc-meals', 'Meals', 'expense', 'meals'),
  account('acc-sales', 'Sales', 'income', 'turnover'),
];

const draft: ListedReceipt = {
  id: '11111111-1111-4111-8111-111111111111',
  fileName: 'cafe-lunch.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 2048,
  uploadStatus: 'ready',
  createdAt: '2026-10-30T10:00:00Z',
  aiStatus: 'extracted',
  readUrl: 'https://files.test/cafe-lunch.jpg',
  details: {
    date: { value: '2026-10-28', confirmed: false, confidence: 950 },
    vendor: { value: 'Corner Cafe', confirmed: false, confidence: 400 },
    totalPence: { value: '1200', confirmed: false, confidence: 900 },
    vatPence: { value: '200', confirmed: false, confidence: 900 },
    category: { value: 'meals', confirmed: false, confidence: 800 },
  },
};

function renderReview(onDone = vi.fn()) {
  vi.mocked(fetchAccounts).mockResolvedValue(accounts);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ReceiptReview receipt={draft} onDone={onDone} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onDone;
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ReceiptReview', () => {
  it('marks low-confidence fields with text and a highlight, and leaves sure ones alone', async () => {
    renderReview();
    const who = (await screen.findByLabelText(/who it was from/i)).closest('[data-field]') as HTMLElement;
    const date = screen.getByLabelText(/^date/i).closest('[data-field]') as HTMLElement;
    expect(within(who).getByText('Check this one')).toBeTruthy();
    expect(who.getAttribute('data-low-confidence')).toBe('true');
    expect(within(date).getByText('Sure')).toBeTruthy();
    expect(date.getAttribute('data-low-confidence')).toBeNull();
  });

  it('says these are suggestions to check', async () => {
    renderReview();
    expect(await screen.findByText(/suggestions/i)).toBeTruthy();
  });

  it('offers only active expense accounts as categories', async () => {
    renderReview();
    const select = (await screen.findByLabelText(/category/i)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('acc-meals'));
    const names = Array.from(select.options).map((option) => option.text);
    expect(names).toContain('Travel');
    expect(names).not.toContain('Sales');
    expect(fetchAccounts).toHaveBeenCalledWith(false);
  });

  it('sends the edited values as integer pence, not the original suggestion', async () => {
    vi.mocked(confirmReceiptDraft).mockResolvedValue('entry-9');
    renderReview();
    fireEvent.change(await screen.findByLabelText(/who it was from/i), { target: { value: 'Station Kiosk' } });
    fireEvent.change(screen.getByLabelText(/total/i), { target: { value: '24.00' } });
    fireEvent.change(screen.getByLabelText(/tax paid/i), { target: { value: '4.00' } });
    await waitFor(() => expect((screen.getByLabelText(/category/i) as HTMLSelectElement).value).toBe('acc-meals'));
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'acc-travel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(confirmReceiptDraft).toHaveBeenCalledTimes(1));
    expect(confirmReceiptDraft).toHaveBeenCalledWith({
      id: draft.id,
      date: '2026-10-28',
      supplier: 'Station Kiosk',
      grossPence: 2400,
      vatRatePercent: 20,
      categoryAccountId: 'acc-travel',
      description: 'Station Kiosk',
    });
  });

  it('links to the new entry after confirming', async () => {
    vi.mocked(confirmReceiptDraft).mockResolvedValue('entry-9');
    renderReview();
    await waitFor(() => expect((screen.getByLabelText(/category/i) as HTMLSelectElement).value).toBe('acc-meals'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    const link = await screen.findByRole('link', { name: /see.*expense/i });
    expect(link.getAttribute('href')).toContain('entry-9');
  });

  it('shows a refusal with its fix and keeps the form', async () => {
    vi.mocked(confirmReceiptDraft).mockRejectedValue(new Error('That date is in a closed tax year. Pick a later date.'));
    renderReview();
    await waitFor(() => expect((screen.getByLabelText(/category/i) as HTMLSelectElement).value).toBe('acc-meals'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Pick a later date.');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  });

  it('asks before discarding, then discards and returns to the list', async () => {
    vi.mocked(discardReceiptDraft).mockResolvedValue();
    const onDone = renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(discardReceiptDraft).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/cafe-lunch\.jpg/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard receipt' }));
    await waitFor(() => expect(discardReceiptDraft).toHaveBeenCalledWith(draft.id));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('does not discard when the owner keeps the receipt', async () => {
    renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep it' }));
    expect(discardReceiptDraft).not.toHaveBeenCalled();
  });
});
