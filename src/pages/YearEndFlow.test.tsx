// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmItsAnnual, previewItsAnnual, submitItsAnnual, type ItsAnnualPreview } from '../lib/itsAnnualApi';
import YearEndFlow from './YearEndFlow';

vi.mock('../lib/itsAnnualApi');

const preview = (body: ItsAnnualPreview['body'], sandbox = true): ItsAnnualPreview => ({
  endpoint: { method: 'PUT', url: 'https://example.test', sandbox },
  body,
  headers: {},
});

const withAllowance = preview({ allowances: { tradingIncomeAllowance: '1000.00' } });
const withAdjustment = preview({ allowances: { tradingIncomeAllowance: '1000.00' }, adjustments: { includedNonTaxableProfits: '250.50' } });
const actualExpenses = preview({});

function renderFlow(onLeave = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <YearEndFlow taxYear="2026-27" onLeave={onLeave} />
    </QueryClientProvider>,
  );
  return onLeave;
}

beforeEach(() => {
  vi.mocked(confirmItsAnnual).mockResolvedValue();
  vi.mocked(submitItsAnnual).mockResolvedValue({ sandbox: true });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('YearEndFlow', () => {
  it('shows the trading allowance choice in pounds on step 1 with a step count', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(withAllowance);
    renderFlow();
    expect(await screen.findByText('Step 1 of 2')).toBeTruthy();
    expect(screen.getByText('£1,000.00')).toBeTruthy();
    expect(screen.getByText('tradingIncomeAllowance')).toBeTruthy();
  });

  it('says so when the owner claims actual expenses instead', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(actualExpenses);
    renderFlow();
    expect(await screen.findByText(/actual costs/i)).toBeTruthy();
    expect(screen.queryByText('£1,000.00')).toBeNull();
  });

  it('gives each adjustment its own step and Back returns to the previous one', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(withAdjustment);
    renderFlow();
    await screen.findByText('Step 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect(screen.getByText('£250.50')).toBeTruthy();
    expect(screen.getByText('includedNonTaxableProfits')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  });

  it('has no Back on the first step', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(withAllowance);
    renderFlow();
    await screen.findByText('Step 1 of 2');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('Save and leave hands control back without sending anything', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(withAllowance);
    const onLeave = renderFlow();
    await screen.findByText('Step 1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Save and leave' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(confirmItsAnnual).not.toHaveBeenCalled();
    expect(submitItsAnnual).not.toHaveBeenCalled();
  });

  it('opens a plain explanation under Why is this amount?', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(withAllowance);
    renderFlow();
    await screen.findByText('Step 1 of 2');
    const why = screen.getByText('Why is this amount?');
    fireEvent.click(why);
    expect(why.closest('details')?.open).toBe(true);
  });

  it('keeps Send to HMRC disabled until the declaration is ticked and confirm succeeds', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(withAllowance);
    renderFlow();
    await screen.findByText('Step 1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const send = screen.getByRole('button', { name: 'Send to HMRC' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(send.disabled).toBe(false));
    expect(confirmItsAnnual).toHaveBeenCalledWith('2026-27');
    expect(submitItsAnnual).not.toHaveBeenCalled();
  });

  it('keeps Send disabled and shows the reason when confirm fails', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(withAllowance);
    vi.mocked(confirmItsAnnual).mockRejectedValue(new Error('Connect HMRC first'));
    renderFlow();
    await screen.findByText('Step 1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(await screen.findByText('Connect HMRC first')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send to HMRC' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('labels sandbox, sends once and shows the result', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(withAllowance);
    renderFlow();
    await screen.findByText('Step 1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/test mode/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    const send = screen.getByRole('button', { name: 'Send to HMRC' }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    expect(await screen.findByText(/sent to HMRC/i)).toBeTruthy();
    expect(submitItsAnnual).toHaveBeenCalledTimes(1);
  });

  it('shows an error with retry when the preview fails', async () => {
    vi.mocked(previewItsAnnual).mockRejectedValue(new Error('Connect HMRC first'));
    renderFlow();
    expect(await screen.findByText('Connect HMRC first')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
