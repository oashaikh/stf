// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DuplicateNotice from './DuplicateNotice';

afterEach(cleanup);

describe('DuplicateNotice', () => {
  it('shows the message and calls onDismiss from a button', () => {
    const onDismiss = vi.fn();
    render(<DuplicateNotice onDismiss={onDismiss}>This looks like one you already added.</DuplicateNotice>);
    expect(screen.getByRole('status')).toHaveTextContent('This looks like one you already added.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
