// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TaxIdentifiersSection from './TaxIdentifiersSection';

describe('TaxIdentifiersSection', () => {
  let puts: unknown[];
  beforeEach(() => {
    puts = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const sent = JSON.parse(init.body as string);
          puts.push(sent);
          if (sent.utr === '1') return { ok: false, json: async () => ({ ok: false, error: 'UTR must be 10 digits' }) };
          return { ok: true, json: async () => ({ ok: true, nino: '••••••56C', utr: '••••••7890' }) };
        }
        return { ok: true, json: async () => ({ ok: true, nino: null, utr: '••••••7890' }) };
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows masked values and starts the edit form empty', async () => {
    render(<TaxIdentifiersSection />);
    expect(await screen.findByText('••••••7890')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit tax identifiers' }));
    expect(screen.getByLabelText('UTR (10 digits)')).toHaveValue('');
  });

  it('sends only the filled fields and shows the masked result', async () => {
    render(<TaxIdentifiersSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit tax identifiers' }));
    fireEvent.change(screen.getByLabelText('National Insurance number'), { target: { value: 'AB123456C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tax identifiers' }));
    expect(await screen.findByText('••••••56C')).toBeInTheDocument();
    expect(puts).toEqual([{ nino: 'AB123456C' }]);
    expect(screen.queryByText(/AB123456C/)).toBeNull();
  });

  it('keeps the form open and shows the server message when saving fails', async () => {
    render(<TaxIdentifiersSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit tax identifiers' }));
    fireEvent.change(screen.getByLabelText('UTR (10 digits)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tax identifiers' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('UTR must be 10 digits');
    expect(screen.getByLabelText('UTR (10 digits)')).toBeInTheDocument();
  });
});
