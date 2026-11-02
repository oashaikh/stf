// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import MoneyInPage from './MoneyInPage';

vi.mock('./InvoicesPage', () => ({ default: () => <p>invoices content</p> }));
vi.mock('./ExpensesPage', () => ({ default: () => <p>other income content</p> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/money-in/*" element={<MoneyInPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MoneyInPage', () => {
  it('shows Invoices and Other income tabs, opening on invoices', () => {
    renderAt('/money-in');
    expect(screen.getByRole('link', { name: 'Invoices' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Other income' })).toBeTruthy();
    expect(screen.getByText('invoices content')).toBeTruthy();
  });

  it('opens the Other income tab from its address', () => {
    renderAt('/money-in/other');
    expect(screen.getByText('other income content')).toBeTruthy();
  });
});
