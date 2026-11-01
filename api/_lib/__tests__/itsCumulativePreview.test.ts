import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { itsCumulativePreviewSchema } from '../itsCumulativePreview';

describe('itsCumulativePreviewSchema', () => {
  it('accepts a known tax year and a quarter from 1 to 4', () => {
    expect(itsCumulativePreviewSchema.safeParse({ taxYear: '2026-27', quarter: 4 }).success).toBe(true);
  });

  it('refuses a well-formed year that has no tax bands', () => {
    expect(itsCumulativePreviewSchema.safeParse({ taxYear: '2010-11', quarter: 1 }).success).toBe(false);
  });
});
