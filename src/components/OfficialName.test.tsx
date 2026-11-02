// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { findJargon } from '../lib/jargon';
import OfficialName from './OfficialName';

afterEach(cleanup);

describe('OfficialName', () => {
  it('renders its text with the marker the jargon scanner looks for', () => {
    render(<OfficialName>Box 1</OfficialName>);
    expect(screen.getByText('Box 1')).toHaveAttribute('data-official-name');
  });

  it('keeps its jargon out of the scanner results', () => {
    const { container } = render(<OfficialName>Box 1</OfficialName>);
    expect(findJargon(container)).toEqual([]);
  });
});
