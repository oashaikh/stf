// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StateMessage from './StateMessage';

afterEach(cleanup);

describe('StateMessage', () => {
  it('announces loading as a status', () => {
    render(<StateMessage kind="loading">Loading…</StateMessage>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('announces an error as an alert', () => {
    render(<StateMessage kind="error">Could not load.</StateMessage>);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load.');
  });

  it('renders empty text with no live-region role', () => {
    render(<StateMessage kind="empty">Nothing yet.</StateMessage>);
    expect(screen.getByText('Nothing yet.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a retry button only when onRetry is given and calls it', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<StateMessage kind="error">Could not load.</StateMessage>);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    rerender(<StateMessage kind="error" onRetry={onRetry}>Could not load.</StateMessage>);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
