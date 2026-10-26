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
