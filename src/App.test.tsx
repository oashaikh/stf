// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('public legal pages', () => {
  it.each([
    ['/privacy', 'Privacy policy'],
    ['/terms', 'Terms of use'],
  ])('%s loads without a session and without calling the server', (path, heading) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', path);
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the other pages behind sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response));
    window.history.pushState({}, '', '/vat');
    render(<App />);
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });
});

describe('old addresses', () => {
  it.each([
    ['/dashboard', '/home'],
    ['/invoices', '/money-in'],
    ['/expenses?status=draft', '/money-out?status=draft'],
    ['/expenses?from=2026-08-15#entry-1', '/money-out?from=2026-08-15#entry-1'],
    ['/receipts', '/money-out/receipts'],
    ['/vat', '/tax/vat'],
    ['/reports', '/tax/reports'],
    ['/', '/home'],
    ['/nowhere', '/home'],
  ])('%s lands on %s', async (from, to) => {
    // Only the session probe succeeds; page data requests fail into each page's error state.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({ ok: url === '/api/me', status: url === '/api/me' ? 200 : 500, json: async () => ({}) }) as Response),
    );
    window.history.pushState({}, '', from);
    // A fresh module gives a fresh query cache, so the session answer from an earlier test is not reused.
    vi.resetModules();
    const { default: FreshApp } = await import('./App');
    render(<FreshApp />);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(to);
  });
});
