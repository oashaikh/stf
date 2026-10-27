// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BusinessProfileSection from './BusinessProfileSection';

const stored = {
  businessName: 'Test Plumbing',
  businessAddress: '1 Example Street',
  paymentBankName: 'Example Bank',
  paymentSortCode: '112233',
  paymentAccountNumber: '12345678',
  invoicePrefix: 'INV-',
  nextInvoiceNumber: 1,
};

describe('BusinessProfileSection', () => {
  let puts: unknown[];
  beforeEach(() => {
    puts = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const sent = JSON.parse(init.body as string);
          puts.push(sent);
          if (sent.paymentSortCode === '1') return { ok: false, json: async () => ({ ok: false, error: 'Sort code must be 6 digits' }) };
          return { ok: true, json: async () => ({ ok: true, profile: sent }) };
        }
        return { ok: true, json: async () => ({ ok: true, profile: stored }) };
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('masks payment details until Edit is pressed', async () => {
    render(<BusinessProfileSection />);
    expect(await screen.findByText('••••5678')).toBeInTheDocument();
    expect(screen.queryByText(/12345678/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit business profile' }));
    expect(screen.getByLabelText('Account number (8 digits)')).toHaveValue('12345678');
    expect(screen.getByLabelText('Sort code (6 digits)')).toHaveValue('112233');
  });

  it('saves the edited profile with a numeric next invoice number and masks again', async () => {
    render(<BusinessProfileSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit business profile' }));
    fireEvent.change(screen.getByLabelText('Invoice prefix'), { target: { value: 'TP-' } });
    fireEvent.change(screen.getByLabelText('Next invoice number'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save business profile' }));
    expect(await screen.findByRole('button', { name: 'Edit business profile' })).toBeInTheDocument();
    expect(puts).toEqual([{ ...stored, invoicePrefix: 'TP-', nextInvoiceNumber: 42 }]);
    expect(screen.getByText('TP-')).toBeInTheDocument();
    expect(screen.queryByText(/12345678/)).toBeNull();
  });

  it('keeps the form open and shows the server message when saving fails', async () => {
    render(<BusinessProfileSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit business profile' }));
    fireEvent.change(screen.getByLabelText('Sort code (6 digits)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save business profile' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sort code must be 6 digits'));
    expect(screen.getByLabelText('Sort code (6 digits)')).toBeInTheDocument();
  });
});
