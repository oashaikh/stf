// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import MoneyOutPage from './MoneyOutPage';

vi.mock('./ExpensesPage', () => ({ default: () => <p>expenses content</p> }));
vi.mock('./ReceiptsPage', () => ({ default: () => <p>receipts content</p> }));
vi.mock('./ReceiptReview', () => ({ ReceiptReviewPage: () => <p>receipt review content</p> }));
vi.mock('./MileageSection', () => ({ default: () => <p>mileage content</p> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/money-out/*" element={<MoneyOutPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MoneyOutPage', () => {
  it('shows Expenses, Receipts and Mileage tabs', () => {
    renderAt('/money-out');
    for (const name of ['Expenses', 'Receipts', 'Mileage']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
    expect(screen.getByText('expenses content')).toBeTruthy();
  });

  it.each([
    ['/money-out/receipts', 'receipts content'],
    ['/money-out/receipts/abc', 'receipt review content'],
    ['/money-out/mileage', 'mileage content'],
  ])('%s opens its own tab', (path, content) => {
    renderAt(path);
    expect(screen.getByText(content)).toBeTruthy();
  });
});
