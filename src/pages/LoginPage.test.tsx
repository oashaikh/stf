// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_QUERY_KEY } from '../lib/session';
import LoginPage from './LoginPage';

const queryClient = new QueryClient();

function submitWith(status: number) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => ({ ok: true }) } as Response);
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
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
  it('links to the privacy policy and terms', () => {
    submitWith(200);
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms of use' })).toHaveAttribute('href', '/terms');
  });

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

  describe('second step', () => {
    function reply(status: number, body: object = {}) {
      return { ok: status < 400, status, json: async () => body } as Response;
    }

    async function reachCodeStep(codeReply: Response) {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(reply(200, { ok: true, mfaRequired: true }))
        .mockResolvedValue(codeReply);
      vi.stubGlobal('fetch', fetchMock);
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      const input = await screen.findByLabelText('Authenticator code');
      return { fetchMock, input };
    }

    it('asks for the code after the password and signs in once it is accepted', async () => {
      const { fetchMock, input } = await reachCodeStep(reply(200));
      expect(input).toHaveAttribute('autocomplete', 'one-time-code');
      expect(input).toHaveAttribute('inputmode', 'numeric');
      expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeUndefined();
      fireEvent.change(input, { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await waitFor(() => expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBe(true));
      const [path, init] = fetchMock.mock.calls[1];
      expect(path).toBe('/api/auth/mfa');
      expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ code: '123456' }) });
    });

    it('stays on the code step with an error when the code is wrong', async () => {
      const { input } = await reachCodeStep(reply(401));
      fireEvent.change(input, { target: { value: '000000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('code is not right');
      expect(screen.getByLabelText('Authenticator code')).toBeInTheDocument();
      expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeUndefined();
    });

    it('ties the error to the code field for screen readers', async () => {
      const { input } = await reachCodeStep(reply(401));
      fireEvent.change(input, { target: { value: '000000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      const alert = await screen.findByRole('alert');
      expect(screen.getByLabelText('Authenticator code')).toHaveAttribute('aria-describedby', alert.id);
    });

    it('returns to the password step when the sign-in challenge has expired', async () => {
      const { input } = await reachCodeStep(reply(401, { ok: false, code: 'CHALLENGE_EXPIRED' }));
      fireEvent.change(input, { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Enter your password again');
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('shows the lockout message on 429', async () => {
      const { input } = await reachCodeStep(reply(429));
      fireEvent.change(input, { target: { value: '000000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Too many failed attempts');
    });

    it('switches to a recovery code field', async () => {
      await reachCodeStep(reply(200));
      fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
      expect(screen.getByLabelText('Recovery code')).toBeInTheDocument();
    });
  });
});
