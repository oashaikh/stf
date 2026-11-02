// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { dismissDuplicate, isDuplicateDismissed } from './duplicateDismissals';

beforeEach(() => localStorage.clear());

describe('duplicate dismissals', () => {
  it('starts with nothing dismissed', () => {
    expect(isDuplicateDismissed('a|b')).toBe(false);
  });

  it('keeps a dismissed key dismissed on a later read, and leaves others alone', () => {
    dismissDuplicate('a|b');
    expect(isDuplicateDismissed('a|b')).toBe(true);
    expect(isDuplicateDismissed('a|c')).toBe(false);
  });

  it('survives corrupt stored data', () => {
    localStorage.setItem('stf-duplicate-dismissed', 'not json');
    expect(isDuplicateDismissed('a|b')).toBe(false);
  });
});
