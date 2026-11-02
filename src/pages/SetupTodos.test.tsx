// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SetupFacts } from '../lib/setupFlow';
import SetupTodos from './SetupTodos';

const setupApi = vi.hoisted(() => ({ fetchSetupFacts: vi.fn(), SETUP_FACTS_QUERY_KEY: ['setup-facts'] }));
vi.mock('../lib/setupApi', () => setupApi);

const skippedEverything: SetupFacts = {
  setup: { businessType: 'sole_trader', vatRegistered: null, skippedSteps: ['business_type', 'vat', 'hmrc', 'bank'], finishedAt: null },
  hmrcConnected: false,
  bankConnected: false,
  hasVatNumber: false,
};

function renderTodos() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SetupTodos />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SetupTodos', () => {
  it('shows one row per skipped step, each with one link that reopens that step', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue(skippedEverything);
    renderTodos();
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(4);
    const links = rows.map((row) => within(row).getByRole('link').getAttribute('href'));
    expect(links).toEqual(['/setup?step=business_type', '/setup?step=vat', '/setup?step=hmrc', '/setup?step=bank']);
    expect(screen.getByText('Connect to HMRC')).toBeInTheDocument();
  });

  it('drops the row of a step that has been finished', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue({ ...skippedEverything, bankConnected: true });
    renderTodos();
    expect(await screen.findAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText('Connect your bank')).not.toBeInTheDocument();
  });

  it('renders nothing when there is nothing left to do', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue({ ...skippedEverything, setup: { ...skippedEverything.setup, skippedSteps: [] } });
    renderTodos();
    await vi.waitFor(() => expect(setupApi.fetchSetupFacts).toHaveBeenCalled());
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows an error message when the setup cannot be loaded', async () => {
    setupApi.fetchSetupFacts.mockRejectedValue(new Error('down'));
    renderTodos();
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load your setup to-dos.');
  });
});
