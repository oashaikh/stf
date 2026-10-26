import { describe, expect, it } from 'vitest';
import { boxLabel, currentQuarter, reviewState } from './vatReviewState';

const base = { status: 'draft' as const, declarationTicked: true, confirmPending: false };

describe('reviewState', () => {
  it('disables confirm until the declaration is ticked', () => {
    expect(reviewState({ ...base, declarationTicked: false }).canConfirm).toBe(false);
    expect(reviewState(base).canConfirm).toBe(true);
  });
  it('disables confirm while the request is pending', () => {
    expect(reviewState({ ...base, confirmPending: true }).canConfirm).toBe(false);
  });
  it('shows a never-saved return as not yet reviewed and still confirmable', () => {
    const state = reviewState({ ...base, status: null });
    expect(state.statusLabel).toBe('Not yet reviewed');
    expect(state.canConfirm).toBe(true);
  });
  it('locks a confirmed return', () => {
    const state = reviewState({ ...base, status: 'confirmed' });
    expect(state.statusLabel).toBe('Confirmed');
    expect(state.canConfirm).toBe(false);
  });
  it('allows re-confirming when the confirmation is stale', () => {
    const state = reviewState({ ...base, status: 'confirmed', stale: true });
    expect(state.statusLabel).toMatch(/changed/);
    expect(state.canConfirm).toBe(true);
  });
});

describe('boxLabel', () => {
  it('labels a negative box 5 as a refund', () => {
    expect(boxLabel(5, -1200)).toMatch(/refund/);
    expect(boxLabel(5, 1200)).not.toMatch(/refund/);
  });
});

describe('currentQuarter', () => {
  it('returns inclusive quarter dates', () => {
    expect(currentQuarter(new Date('2026-11-05T00:00:00Z'))).toEqual({
      periodKey: '2026-Q4', start: '2026-10-01', end: '2026-12-31',
    });
    expect(currentQuarter(new Date('2026-02-10T00:00:00Z')).end).toBe('2026-03-31');
  });
});
