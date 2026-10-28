// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { fetchHasVatNumber } from '../lib/entriesApi';
import { downloadInvoicePdf, fetchInvoice, fetchInvoices, issueInvoice, markInvoicePaid, saveDraft, voidInvoice, type ApiInvoice } from '../lib/invoicesApi';
import InvoicesPage from './InvoicesPage';

vi.mock('../lib/invoicesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/invoicesApi')>()),
  fetchInvoices: vi.fn(),
  fetchInvoice: vi.fn(),
  saveDraft: vi.fn(),
  issueInvoice: vi.fn(),
  markInvoicePaid: vi.fn(),
  voidInvoice: vi.fn(),
  downloadInvoicePdf: vi.fn(),
}));
vi.mock('../lib/entriesApi', () => ({ fetchHasVatNumber: vi.fn() }));

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  publicNumber: 'INV-0001',
  clientName: 'Acme Ltd',
  issueDate: '2026-05-01',
  dueDate: '2026-05-31',
  status: 'sent' as const,
  totalPence: 18198,
};
const invoice: ApiInvoice = {
  ...row,
  status: 'draft',
  publicNumber: null,
  clientEmail: 'ap@acme.test',
  clientAddress: '1 High Street',
  subtotalPence: 15198,
  vatPence: 3000,
  notes: null,
  lines: [
    { id: 'l1', description: 'Design', quantity: 15000, unitPricePence: 10000, vatRatePercent: 20, subtotalPence: 15000, vatPence: 3000, totalPence: 18000 },
  ],
};

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

function renderPage() {
  vi.mocked(fetchHasVatNumber).mockResolvedValue(true);
  vi.mocked(fetchInvoices).mockResolvedValue({ invoices: [row], nextCursor: null });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InvoicesPage />
    </QueryClientProvider>,
  );
}

async function openInvoice(loaded: ApiInvoice) {
  vi.mocked(fetchInvoice).mockResolvedValue(loaded);
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Acme Ltd/ }));
  await screen.findByRole('heading', { name: /Draft invoice|Invoice INV/ });
}

describe('InvoicesPage list', () => {
  it('shows number, client, dates, total and status, and filters by status', async () => {
    renderPage();
    expect(await screen.findByText('INV-0001')).toBeTruthy();
    expect(screen.getByText('£181.98')).toBeTruthy();
    expect(screen.getByText('31 May 2026')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paid' } });
    await waitFor(() => expect(fetchInvoices).toHaveBeenLastCalledWith('paid', undefined));
  });

  it('labels the total on a phone row so the amount is not a bare figure', async () => {
    renderPage();
    const amount = await screen.findByText('£181.98');
    expect(amount.parentElement?.textContent).toBe('Total £181.98');
  });
});

describe('invoice editor', () => {
  it('recomputes totals as lines change, with VAT from the line rate', async () => {
    await openInvoice(invoice);
    expect(await screen.findByText('£180.00', { selector: '[data-testid="total"]' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
    expect(screen.getByText('£240.00', { selector: '[data-testid="total"]' })).toBeTruthy();
    expect(screen.getByText('£40.00', { selector: '[data-testid="vat"]' })).toBeTruthy();
  });

  it('charges no VAT when the owner has no VAT number', async () => {
    vi.mocked(fetchHasVatNumber).mockResolvedValue(false);
    vi.mocked(fetchInvoice).mockResolvedValue(invoice);
    vi.mocked(fetchInvoices).mockResolvedValue({ invoices: [row], nextCursor: null });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InvoicesPage />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Acme Ltd/ }));
    expect(await screen.findByText('£150.00', { selector: '[data-testid="total"]' })).toBeTruthy();
  });

  it('saves the draft with pence and scaled quantity', async () => {
    vi.mocked(saveDraft).mockResolvedValue(invoice);
    await openInvoice(invoice);
    fireEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    expect(vi.mocked(saveDraft).mock.calls[0][0]).toBe(invoice.id);
    expect(vi.mocked(saveDraft).mock.calls[0][1].lines[0]).toMatchObject({ quantity: 15000, unitPricePence: 10000, vatRatePercent: 20 });
  });

  it('shows validation errors instead of saving an empty client name', async () => {
    await openInvoice(invoice);
    fireEvent.change(await screen.findByLabelText('Client name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Enter the client name')).toBeTruthy();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('asks for confirmation before issuing, then saves and issues', async () => {
    vi.mocked(saveDraft).mockResolvedValue(invoice);
    vi.mocked(issueInvoice).mockResolvedValue({ ...invoice, status: 'sent', publicNumber: 'INV-0002' });
    await openInvoice(invoice);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue' }));
    expect(issueInvoice).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/can no longer be edited/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    await waitFor(() => expect(issueInvoice).toHaveBeenCalledWith(invoice.id));
    expect(vi.mocked(saveDraft).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(issueInvoice).mock.invocationCallOrder[0]);
  });

  it('retrying a failed issue on a new invoice updates the saved draft instead of creating another', async () => {
    vi.mocked(saveDraft).mockResolvedValue(invoice);
    vi.mocked(issueInvoice).mockRejectedValueOnce(new Error('Server error')).mockResolvedValue({ ...invoice, status: 'sent', publicNumber: 'INV-0002' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New invoice' }));
    fireEvent.change(await screen.findByLabelText('Client name'), { target: { value: 'Acme Ltd' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Design' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Unit price (£)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Issue invoice' }));
    await screen.findByText('Server error');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Issue invoice' }));
    await waitFor(() => expect(issueInvoice).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveDraft).mock.calls.map(([id]) => id)).toEqual([null, invoice.id]);
  });
});

describe('issued invoice view', () => {
  const sent: ApiInvoice = { ...invoice, status: 'sent', publicNumber: 'INV-0001' };

  it('labels each figure on a read-only line so phone rows make sense', async () => {
    await openInvoice({ ...invoice, status: 'sent', publicNumber: 'INV-0001' });
    const line = screen.getByText('Design').closest('li') as HTMLElement;
    for (const label of ['Qty', 'Unit price', 'VAT rate', 'Line total']) expect(within(line).getByText(label)).toBeTruthy();
  });

  it('is read-only: no inputs and no Save or Issue', async () => {
    await openInvoice(sent);
    expect(await screen.findByText('Acme Ltd')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Issue' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark paid' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Void' })).toBeTruthy();
  });

  it('marks paid with the chosen payment date after confirming', async () => {
    vi.mocked(markInvoicePaid).mockResolvedValue({ ...sent, status: 'paid' });
    await openInvoice(sent);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Payment date'), { target: { value: '2026-06-02' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as paid' }));
    await waitFor(() => expect(markInvoicePaid).toHaveBeenCalledWith(sent.id, '2026-06-02'));
  });

  it('voids only with a reason, after confirming', async () => {
    vi.mocked(voidInvoice).mockResolvedValue();
    await openInvoice(sent);
    fireEvent.click(await screen.findByRole('button', { name: 'Void' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Void invoice' }));
    expect(voidInvoice).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Reason/ }), { target: { value: 'Raised in error' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Void invoice' }));
    await waitFor(() => expect(voidInvoice).toHaveBeenCalledWith(sent.id, 'Raised in error'));
  });

  it('offers no actions on a paid invoice other than Void, and none on a voided one', async () => {
    await openInvoice({ ...sent, status: 'paid' });
    expect(await screen.findByText('Acme Ltd')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Void' })).toBeTruthy();
    cleanup();
    await openInvoice({ ...sent, status: 'voided' });
    expect(await screen.findByText('Acme Ltd')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Void' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
  });
});

describe('InvoicesPage PDF download', () => {
  const issued: ApiInvoice = { ...invoice, status: 'sent', publicNumber: 'INV-0001' };

  it('downloads the open invoice as a PDF', async () => {
    await openInvoice(issued);
    vi.mocked(downloadInvoicePdf).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(downloadInvoicePdf).toHaveBeenCalledWith(issued.id, 'INV-0001'));
  });

  it('shows the server error and stays on the invoice when the download fails', async () => {
    await openInvoice(issued);
    vi.mocked(downloadInvoicePdf).mockRejectedValue(new Error('Invoice not found'));
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Invoice not found');
    expect(screen.getByRole('heading', { name: /Invoice INV-0001/ })).toBeTruthy();
  });
});
