// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReportsPage from './ReportsPage';

const csvResponse = () => new Response('Date,Description\n2026-05-01,Invoice 1\n', { status: 200, headers: { 'Content-Type': 'text/csv' } });
let click: ReturnType<typeof vi.fn>;

beforeEach(() => {
  click = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
  URL.createObjectURL = vi.fn(() => 'blob:invented');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setRange(from: string, to: string) {
  fireEvent.change(screen.getByLabelText('From'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: to } });
}

describe('ReportsPage', () => {
  it('shows the range form and no placeholder text', () => {
    render(<ReportsPage />);
    expect(screen.getByLabelText('From')).toBeTruthy();
    expect(screen.getByLabelText('To')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it('downloads the chosen range with from and to only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(csvResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(<ReportsPage />);
    setRange('2026-05-01', '2026-06-30');
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith('/api/entries-export?from=2026-05-01&to=2026-06-30', { credentials: 'same-origin' });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:invented');
  });

  it('shows the server message in an alert when the range is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: false, error: 'That range has too many entries. Choose a shorter range.' }, { status: 400 })));
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect((await screen.findByRole('alert')).textContent).toContain('too many entries');
    expect(click).not.toHaveBeenCalled();
  });

  it('blocks an inverted range without a request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ReportsPage />);
    setRange('2026-06-30', '2026-05-01');
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(screen.getByRole('alert').textContent).toContain('before');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables the button while downloading', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    const button = await screen.findByRole('button', { name: 'Downloading...' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
