// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { fetchAccounts } from '../lib/accountsApi';
import { createTemplate, deleteTemplate, fetchTemplates, updateTemplate, type ApiTemplate } from '../lib/recurringEntriesApi';
import RecurringEntriesSection from './RecurringEntriesSection';

vi.mock('../lib/recurringEntriesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/recurringEntriesApi')>()),
  fetchTemplates: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
vi.mock('../lib/accountsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/accountsApi')>()),
  fetchAccounts: vi.fn(),
}));

const rent: ApiTemplate = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'expense',
  categoryAccountId: 'a2',
  amountPence: 85000,
  amountIs: 'gross',
  vatRatePercent: 0,
  description: 'Studio rent',
  schedule: 'monthly',
  nextDate: '2026-11-01',
  paused: false,
};
const accounts = [
  { id: 'a1', code: '4000', name: 'Sales', accountType: 'income' as const, taxCategory: null, isSystem: false },
  { id: 'a2', code: '7000', name: 'Premises', accountType: 'expense' as const, taxCategory: null, isSystem: false },
];

beforeAll(() => {
  // jsdom has no modal dialog support.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderSection(hasVatNumber = false, templates: ApiTemplate[] = [rent]) {
  vi.mocked(fetchTemplates).mockResolvedValue(templates);
  vi.mocked(fetchAccounts).mockResolvedValue(accounts);
  vi.mocked(createTemplate).mockResolvedValue(new Response());
  vi.mocked(updateTemplate).mockResolvedValue(new Response());
  vi.mocked(deleteTemplate).mockResolvedValue(new Response());
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RecurringEntriesSection hasVatNumber={hasVatNumber} />
    </QueryClientProvider>,
  );
}

describe('RecurringEntriesSection', () => {
  it('lists templates with amount, schedule and next date', async () => {
    renderSection();
    const row = (await screen.findByText('Studio rent')).closest('tr')!;
    expect(row).toHaveTextContent('£850.00');
    expect(row).toHaveTextContent('Monthly');
    expect(row).toHaveTextContent('1 Nov 2026');
    expect(row).toHaveTextContent('Money out');
  });

  it('says so when there are no templates, and when loading fails', async () => {
    renderSection(false, []);
    expect(await screen.findByText(/No recurring entries yet/)).toBeInTheDocument();
    cleanup();
    vi.mocked(fetchTemplates).mockRejectedValue(new Error('boom'));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RecurringEntriesSection hasVatNumber={false} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load recurring entries');
  });

  it('creates a template in pence, and only offers VAT with a VAT number', async () => {
    renderSection(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Add recurring entry' }));
    expect(screen.queryByLabelText('VAT rate')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Software' } });
    fireEvent.change(screen.getByLabelText('Amount in pounds'), { target: { value: '12.50' } });
    fireEvent.change(screen.getByLabelText('First date'), { target: { value: '2026-12-31' } });
    await screen.findByRole('option', { name: 'Premises' });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'a2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save recurring entry' }));
    await waitFor(() => expect(createTemplate).toHaveBeenCalled());
    expect(vi.mocked(createTemplate).mock.calls[0][0]).toEqual({
      kind: 'expense',
      categoryAccountId: 'a2',
      amountPence: 1250,
      amountIs: 'gross',
      vatRatePercent: 0,
      description: 'Software',
      schedule: 'monthly',
      nextDate: '2026-12-31',
    });
  });

  it('shows the VAT rate field when the business has a VAT number', async () => {
    renderSection(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Add recurring entry' }));
    expect(screen.getByLabelText('VAT rate')).toBeInTheDocument();
  });

  it('refuses an empty form without calling the API', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Add recurring entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save recurring entry' }));
    expect(await screen.findByText('Enter a description')).toBeInTheDocument();
    expect(createTemplate).not.toHaveBeenCalled();
  });

  it('pauses and resumes', async () => {
    renderSection(false, [rent]);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause Studio rent' }));
    await waitFor(() => expect(updateTemplate).toHaveBeenCalledWith(rent.id, { paused: true }));
    cleanup();
    renderSection(false, [{ ...rent, paused: true }]);
    const row = (await screen.findByText('Studio rent')).closest('tr')!;
    expect(row).toHaveTextContent('Paused');
    fireEvent.click(within(row).getByRole('button', { name: 'Resume Studio rent' }));
    await waitFor(() => expect(updateTemplate).toHaveBeenCalledWith(rent.id, { paused: false }));
  });

  it('edits the amount and description of a template', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Studio rent' }));
    fireEvent.change(screen.getByLabelText('Amount in pounds'), { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateTemplate).toHaveBeenCalled());
    expect(vi.mocked(updateTemplate).mock.calls[0]).toEqual([
      rent.id,
      { amountPence: 90000, amountIs: 'gross', vatRatePercent: 0, description: 'Studio rent', nextDate: '2026-11-01' },
    ]);
  });

  it('asks before deleting and names the template', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Studio rent' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete Studio rent?');
    expect(deleteTemplate).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete template' }));
    await waitFor(() => expect(deleteTemplate).toHaveBeenCalledWith(rent.id));
  });
});
