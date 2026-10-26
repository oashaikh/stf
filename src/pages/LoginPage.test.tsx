// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_QUERY_KEY } from '../lib/session';
import LoginPage from './LoginPage';

const queryClient = new QueryClient();

function submitWith(status: number) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status } as Response);
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={queryClient}>
      <LoginPage />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  queryClient.clear();
});

describe('LoginPage', () => {
  it('posts the password to the login route and marks the session signed in', async () => {
    const fetchMock = submitWith(200);
    await waitFor(() => expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBe(true));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/auth/login');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ password: 'hunter2' }) });
  });

  it('shows a wrong-password message and clears the field', async () => {
    submitWith(401);
    expect(await screen.findByRole('alert')).toHaveTextContent('not right');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeUndefined();
  });

  it('shows the lockout message on 429', async () => {
    submitWith(429);
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many failed attempts');
  });
});
