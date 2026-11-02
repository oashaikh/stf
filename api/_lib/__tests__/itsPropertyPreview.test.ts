import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { itsPropertyPreviewSchema } from '../itsPropertyPreview';

describe('itsPropertyPreviewSchema', () => {
  it('accepts a known tax year and a quarter from 1 to 4', () => {
    expect(itsPropertyPreviewSchema.safeParse({ taxYear: '2026-27', quarter: 4 }).success).toBe(true);
  });

  it('refuses a year with no tax bands, a bad quarter and extra fields', () => {
    expect(itsPropertyPreviewSchema.safeParse({ taxYear: '2010-11', quarter: 1 }).success).toBe(false);
    expect(itsPropertyPreviewSchema.safeParse({ taxYear: '2026-27', quarter: 5 }).success).toBe(false);
    expect(itsPropertyPreviewSchema.safeParse({ taxYear: '2026-27', quarter: 1, businessId: 'x' }).success).toBe(false);
  });
});
