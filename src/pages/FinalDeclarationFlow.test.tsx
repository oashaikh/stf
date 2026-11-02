// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmItsFinal, previewItsFinal, submitItsFinal, type ItsFinalPreview } from '../lib/itsFinalApi';
import FinalDeclarationFlow from './FinalDeclarationFlow';

vi.mock('../lib/itsFinalApi');

const WORDING = 'I declare that the information I have given on this return is correct and complete to the best of my knowledge.';

const preview = (overrides: Partial<ItsFinalPreview> = {}): ItsFinalPreview => ({
  sandbox: true,
  calculationId: 'calc-1',
  hmrc: { incomeTaxPence: 150000, class2NicPence: 0, class4NicPence: 50000, totalPence: 200000 },
  stfEstimate: { incomeTaxPence: 150000, class2NicPence: 0, class4NicPence: 50000, totalPence: 200000 },
  comparison: { incomeTaxDifferencePence: 0, nicDifferencePence: 0, totalDifferencePence: 0, differs: false },
  declarationWording: WORDING,
  ...overrides,
});

const differing = preview({
  hmrc: { incomeTaxPence: 250000, class2NicPence: 0, class4NicPence: 50000, totalPence: 300000 },
  comparison: { incomeTaxDifferencePence: 100000, nicDifferencePence: 0, totalDifferencePence: 100000, differs: true },
});

function renderFlow(onLeave = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FinalDeclarationFlow taxYear="2026-27" onLeave={onLeave} />
    </QueryClientProvider>,
  );
  return onLeave;
}

beforeEach(() => {
  vi.mocked(previewItsFinal).mockResolvedValue(preview());
  vi.mocked(confirmItsFinal).mockResolvedValue();
  vi.mocked(submitItsFinal).mockResolvedValue({ sandbox: true });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('FinalDeclarationFlow', () => {
  it('shows HMRC figures beside the estimate, formatted as pounds', async () => {
    vi.mocked(previewItsFinal).mockResolvedValue(differing);
    renderFlow();
    expect(await screen.findByText('£2,500.00')).toBeInTheDocument();
    expect(screen.getAllByText('£1,500.00').length).toBeGreaterThan(0);
    expect(screen.getByText('£3,000.00')).toBeInTheDocument();
  });

  it('says in plain words when HMRC is higher than the estimate', async () => {
    vi.mocked(previewItsFinal).mockResolvedValue(differing);
    renderFlow();
    expect(await screen.findByText(/£1,000\.00 more than our estimate/)).toBeInTheDocument();
    expect(screen.getByText(/other income/i)).toBeInTheDocument();
  });

  it('says in plain words when HMRC is lower than the estimate', async () => {
    vi.mocked(previewItsFinal).mockResolvedValue(
      preview({ comparison: { incomeTaxDifferencePence: -5000, nicDifferencePence: 0, totalDifferencePence: -5000, differs: true } }),
    );
    renderFlow();
    expect(await screen.findByText(/£50\.00 less than our estimate/)).toBeInTheDocument();
  });

  it('says the figures match when there is no difference', async () => {
    renderFlow();
    expect(await screen.findByText(/matches our estimate/i)).toBeInTheDocument();
  });

  it('keeps Send disabled until the wording is ticked, and posts the tick before sending', async () => {
    renderFlow();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    const send = screen.getByRole('button', { name: /send to hmrc/i });
    expect(send).toBeDisabled();
    expect(submitItsFinal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: WORDING }));
    await waitFor(() => expect(confirmItsFinal).toHaveBeenCalledWith('2026-27', 'calc-1'));
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    await waitFor(() => expect(submitItsFinal).toHaveBeenCalledWith('2026-27'));
    expect(vi.mocked(confirmItsFinal).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(submitItsFinal).mock.invocationCallOrder[0]);
  });

  it('shows the test-mode badge on the done step in sandbox mode', async () => {
    renderFlow();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('checkbox', { name: WORDING }));
    fireEvent.click(await waitFor(() => {
      const send = screen.getByRole('button', { name: /send to hmrc/i });
      expect(send).toBeEnabled();
      return send;
    }));
    expect(await screen.findByText(/nothing was filed for real/i)).toBeInTheDocument();
  });

  it('shows the server refusal and stays unsent when confirming fails', async () => {
    vi.mocked(confirmItsFinal).mockRejectedValue(new Error('Already declared for this year'));
    renderFlow();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('checkbox', { name: WORDING }));
    expect(await screen.findByText('Already declared for this year')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send to hmrc/i })).toBeDisabled();
  });

  it('shows an error with retry when HMRC cannot be reached', async () => {
    vi.mocked(previewItsFinal).mockRejectedValue(new Error('HMRC is not answering'));
    renderFlow();
    expect(await screen.findByText(/could not get your figures from HMRC/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });
});
