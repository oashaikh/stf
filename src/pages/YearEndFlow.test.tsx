// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchItsBusinesses } from '../lib/hmrc/settingsApi';
import { previewItsPropertyUpdate } from '../lib/hmrc/itsUpdateApi';
import { confirmItsAnnual, previewItsAnnual, submitItsAnnual, type ItsAnnualPreview } from '../lib/itsAnnualApi';
import YearEndFlow from './YearEndFlow';

vi.mock('../lib/itsAnnualApi');
vi.mock('../lib/hmrc/settingsApi');
vi.mock('../lib/hmrc/itsUpdateApi');

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

const noProperty = { businesses: [], selectedBusinessId: null, propertyBusinessId: null };
const withProperty = { ...noProperty, propertyBusinessId: 'XPIS12345678901' };

beforeEach(() => {
  vi.mocked(fetchItsBusinesses).mockResolvedValue(noProperty);
  vi.mocked(confirmItsAnnual).mockResolvedValue();
  vi.mocked(submitItsAnnual).mockResolvedValue({ sandbox: true });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});

describe('YearEndFlow', () => {
  it('resumes at the step the owner left on', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(withAdjustment);
    renderFlow();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    cleanup();
    renderFlow();
    expect(await screen.findByText('Step 2 of 3')).toBeTruthy();
  });

  it('lands on the last step when the saved step no longer exists', async () => {
    localStorage.setItem('its-annual-step:2026-27', '99');
    vi.mocked(previewItsAnnual).mockResolvedValue(withAllowance);
    renderFlow();
    expect(await screen.findByText('Step 2 of 2')).toBeTruthy();
  });

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

  it('offers the rental steps after the self-employment figures are sent, not before', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(withAllowance);
    vi.mocked(fetchItsBusinesses).mockResolvedValue(withProperty);
    vi.mocked(previewItsPropertyUpdate).mockResolvedValue(rentalFigures(12000, 2500));
    renderFlow();
    await screen.findByText('Step 1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('checkbox'));
    const send = screen.getByRole('button', { name: 'Send to HMRC' }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to your rental property' }));
    expect(await screen.findByText('Step 1 of 3')).toBeTruthy();
  });

  it('says Done and no rental steps when there is no property business', async () => {
    vi.mocked(previewItsAnnual).mockResolvedValue(withAllowance);
    renderFlow();
    await screen.findByText('Step 1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('checkbox'));
    const send = screen.getByRole('button', { name: 'Send to HMRC' }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue to your rental property' })).toBeNull();
  });
});

const rentalFigures = (rentPounds: number, costsPounds: number) => ({
  endpoint: { method: 'PUT', url: 'https://example.test', sandbox: true },
  body: { fromDate: '2026-04-06', toDate: '2027-04-05', ukProperty: { income: { periodAmount: rentPounds }, expenses: { premisesRunningCosts: costsPounds } } },
  headers: {},
});

describe('YearEndFlow rental property steps', () => {
  const startRental = (rent = 12000, costs = 2500) => {
    localStorage.setItem('its-property-annual-step:2026-27', '0');
    vi.mocked(fetchItsBusinesses).mockResolvedValue(withProperty);
    vi.mocked(previewItsPropertyUpdate).mockResolvedValue(rentalFigures(rent, costs));
    vi.mocked(previewItsAnnual).mockImplementation(async (target) =>
      typeof target === 'string'
        ? withAllowance
        : preview({ ukProperty: target.choice === 'allowance' ? { allowances: { propertyIncomeAllowance: 1000 } } : {} } as never),
    );
    renderFlow();
  };

  it('shows what you earned and spent on the rental, in pounds', async () => {
    startRental();
    expect(await screen.findByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByText('£12,000.00')).toBeTruthy();
    expect(screen.getByText('£2,500.00')).toBeTruthy();
    expect(screen.getAllByText('Why is this amount?').length).toBe(2);
  });

  it('pre-selects actual costs when they leave more tax-free than the £1,000 allowance', async () => {
    startRental(12000, 2500);
    await screen.findByText('Step 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect((screen.getByRole('radio', { name: /actual costs/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/your actual costs leave more tax-free/i)).toBeTruthy();
  });

  it('pre-selects the flat allowance when it leaves more tax-free', async () => {
    startRental(12000, 400);
    await screen.findByText('Step 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect((screen.getByRole('radio', { name: /£1,000\.00 rental allowance/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/the flat allowance leaves more tax-free/i)).toBeTruthy();
  });

  it('only counts the rent received when it is below the allowance', async () => {
    startRental(300, 0);
    await screen.findByText('Step 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/the flat allowance leaves £300\.00 tax-free/i)).toBeTruthy();
  });

  it('sends nothing until the declaration is ticked and Send is pressed', async () => {
    startRental();
    await screen.findByText('Step 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('radio', { name: /£1,000\.00 rental allowance/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('£1,000.00')).toBeTruthy();
    expect(confirmItsAnnual).not.toHaveBeenCalled();
    const send = screen.getByRole('button', { name: 'Send to HMRC' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(send.disabled).toBe(false));
    expect(confirmItsAnnual).toHaveBeenCalledWith({ taxYear: '2026-27', business: 'uk-property', choice: 'allowance' });
    expect(submitItsAnnual).not.toHaveBeenCalled();
    fireEvent.click(send);
    expect(await screen.findByText(/rental property figures are sent/i)).toBeTruthy();
    expect(submitItsAnnual).toHaveBeenCalledTimes(1);
  });

  it('resumes at the saved step with the saved choice', async () => {
    localStorage.setItem('its-property-annual-choice:2026-27', 'allowance');
    startRental();
    localStorage.setItem('its-property-annual-step:2026-27', '1');
    cleanup();
    renderFlow();
    expect(await screen.findByText('Step 2 of 3')).toBeTruthy();
    expect((screen.getByRole('radio', { name: /rental allowance/i }) as HTMLInputElement).checked).toBe(true);
  });

  it('explains a failed send in plain words and keeps the flow open', async () => {
    startRental();
    vi.mocked(submitItsAnnual).mockRejectedValue(new Error('HMRC could not take your figures. Nothing was sent. Try again shortly.'));
    await screen.findByText('Step 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('checkbox'));
    const send = screen.getByRole('button', { name: 'Send to HMRC' }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    expect(await screen.findByText(/Nothing was sent/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send to HMRC' })).toBeTruthy();
  });

  it('shows a retry when the rental figures cannot be loaded', async () => {
    startRental();
    vi.mocked(previewItsPropertyUpdate).mockRejectedValue(new Error('Connect HMRC first'));
    cleanup();
    renderFlow();
    expect(await screen.findByText('Connect HMRC first')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
