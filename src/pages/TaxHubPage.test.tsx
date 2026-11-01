// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TaxHubPage from './TaxHubPage';

vi.mock('./VatPage', () => ({ default: () => <p>vat content</p> }));
vi.mock('./TaxPage', () => ({ default: () => <p>income tax content</p> }));
vi.mock('./VatHistoryList', () => ({ default: () => <p>past returns content</p> }));
vi.mock('./ReportsPage', () => ({ default: () => <p>reports content</p> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/tax/*" element={<TaxHubPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('TaxHubPage', () => {
  it('shows VAT, Income Tax, Past returns and Reports tabs', () => {
    renderAt('/tax/vat');
    for (const name of ['VAT', 'Income Tax', 'Past returns', 'Reports']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
  });

  it.each([
    ['/tax', 'vat content'],
    ['/tax/vat', 'vat content'],
    ['/tax/income-tax', 'income tax content'],
    ['/tax/past-returns', 'past returns content'],
    ['/tax/reports', 'reports content'],
  ])('%s opens the right tab', (path, content) => {
    renderAt(path);
    expect(screen.getByText(content)).toBeTruthy();
  });
});
