// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { enablePropertyAccounts, fetchAccounts } from '../lib/accountsApi';
import { findJargon } from '../lib/jargon';
import UkPropertyPrompt from './UkPropertyPrompt';

vi.mock('../lib/accountsApi', () => ({ fetchAccounts: vi.fn(), enablePropertyAccounts: vi.fn() }));

const business = { id: 'a1', code: '4000', name: 'Sales', accountType: 'income' as const, taxCategory: 'turnover', isSystem: true };
const rent = { ...business, id: 'p1', name: 'Rent received', taxCategory: 'property-rent-received' };

const renderPrompt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UkPropertyPrompt />
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('UkPropertyPrompt', () => {
  it('asks in plain words and turns rental categories on', async () => {
    vi.mocked(fetchAccounts).mockResolvedValueOnce([business]).mockResolvedValue([business, rent]);
    vi.mocked(enablePropertyAccounts).mockResolvedValue([business, rent]);
    renderPrompt();
    expect(findJargon(document.body)).toEqual([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on rental categories' }));
    await waitFor(() => expect(enablePropertyAccounts).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Rental categories are on/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on rental categories' })).toBeNull();
  });

  it('only confirms when rental categories already exist', async () => {
    vi.mocked(fetchAccounts).mockResolvedValue([business, rent]);
    renderPrompt();
    expect(await screen.findByText(/Rental categories are on/)).toBeInTheDocument();
    expect(enablePropertyAccounts).not.toHaveBeenCalled();
  });

  it('says what went wrong when turning on fails', async () => {
    vi.mocked(fetchAccounts).mockResolvedValue([business]);
    vi.mocked(enablePropertyAccounts).mockRejectedValue(new Error('x'));
    renderPrompt();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on rental categories' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing has changed');
  });
});
