// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import SectionTabs from './SectionTabs';

const TABS = [
  { to: '/money-out', label: 'Expenses' },
  { to: '/money-out/receipts', label: 'Receipts' },
];

describe('SectionTabs', () => {
  it('marks only the tab for the current address', () => {
    render(
      <MemoryRouter initialEntries={['/money-out/receipts']}>
        <SectionTabs label="Money out" tabs={TABS} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('navigation', { name: 'Money out' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Receipts' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Expenses' }).getAttribute('aria-current')).toBeNull();
  });
});
