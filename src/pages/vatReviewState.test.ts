import { describe, expect, it } from 'vitest';
import { boxLabel, reviewState } from './vatReviewState';

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

describe('reviewState submit', () => {
  const confirmed = { ...base, status: 'confirmed' as const };
  const receipt = { formBundleNumber: '256 SANDBOX 1', processingDate: '2026-04-02T10:00:00.000Z', sandbox: false };

  it('cannot submit until confirmed', () => {
    expect(reviewState(base).canSubmit).toBe(false);
    expect(reviewState({ ...base, status: null }).canSubmit).toBe(false);
  });
  it('cannot submit a stale confirmation', () => {
    expect(reviewState({ ...confirmed, stale: true }).canSubmit).toBe(false);
  });
  it('can submit a confirmed, fresh return', () => {
    expect(reviewState(confirmed).canSubmit).toBe(true);
  });
  it('disables submit and relabels while submitting', () => {
    const state = reviewState({ ...confirmed, submitPending: true });
    expect(state.canSubmit).toBe(false);
    expect(state.submitLabel).toBe('Submitting…');
  });
  it('shows the receipt and disables submit after a live filing', () => {
    const state = reviewState({ ...confirmed, submission: receipt, live: true });
    expect(state.canSubmit).toBe(false);
    expect(state.receipt).toMatchObject({ formBundleNumber: '256 SANDBOX 1', heading: 'Submitted to HMRC' });
  });
  it('labels a sandbox receipt so it is not mistaken for a real filing', () => {
    const state = reviewState({ ...confirmed, submission: { ...receipt, sandbox: true } });
    expect(state.receipt?.heading).toBe('Sandbox test submission');
    expect(state.canSubmit).toBe(false);
  });
  it('lets a sandbox rehearsal be followed by the live filing', () => {
    expect(reviewState({ ...confirmed, submission: { ...receipt, sandbox: true }, live: true }).canSubmit).toBe(true);
  });
  it('names the target in the button label', () => {
    expect(reviewState(confirmed).submitLabel).toBe('Submit to HMRC sandbox');
    expect(reviewState({ ...confirmed, live: true }).submitLabel).toBe('Submit to HMRC');
  });
  it('tells the user not to retry when the outcome is unknown', () => {
    const state = reviewState({ ...confirmed, outcomeUnknown: true });
    expect(state.canSubmit).toBe(false);
    expect(state.warning).toMatch(/Do not submit again/);
  });
  it('renders a nil return like any other', () => {
    expect(reviewState(confirmed).canSubmit).toBe(true);
  });
  it('asks for confirmation of a nil return only while it is unconfirmed and unfiled', () => {
    expect(reviewState(base).needsConfirming).toBe(true);
    expect(reviewState({ ...base, status: null }).needsConfirming).toBe(true);
    expect(reviewState({ ...confirmed, stale: true }).needsConfirming).toBe(true);
    expect(reviewState(confirmed).needsConfirming).toBe(false);
    expect(reviewState({ ...base, submission: receipt }).needsConfirming).toBe(false);
  });
});

describe('boxLabel', () => {
  it('labels a negative box 5 as a refund', () => {
    expect(boxLabel(5, -1200)).toMatch(/refund/);
    expect(boxLabel(5, 1200)).not.toMatch(/refund/);
  });
});
