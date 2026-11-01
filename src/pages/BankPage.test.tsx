// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BankPage from './BankPage';

vi.mock('./BankSection', () => ({ default: () => <p>bank section</p> }));

afterEach(cleanup);

describe('BankPage', () => {
  it('holds the connected accounts section under a Bank heading', () => {
    render(<BankPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bank' })).toBeTruthy();
    expect(screen.getByText('bank section')).toBeTruthy();
  });
});
