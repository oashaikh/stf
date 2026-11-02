import { describe, expect, it } from 'vitest';

import { SETUP_STEPS, nextStep, shouldShowSetup, stepLabel, stepsDone, todoSteps, type SetupFacts } from './setupFlow';

const brandNew: SetupFacts = {
  setup: { businessType: 'sole_trader', vatRegistered: null, skippedSteps: [], finishedAt: null },
  hmrcConnected: false,
  bankConnected: false,
  hasVatNumber: false,
};
const withFacts = (changes: Partial<Omit<SetupFacts, 'setup'>> & { setup?: Partial<SetupFacts['setup']> }): SetupFacts => ({
  ...brandNew,
  ...changes,
  setup: { ...brandNew.setup, ...changes.setup },
});

describe('setup flow', () => {
  it('has the four steps in order', () => {
    expect(SETUP_STEPS.map((step) => step.id)).toEqual(['business_type', 'vat', 'hmrc', 'bank']);
  });

  it('shows step 1 of 4 to a brand-new user', () => {
    expect(shouldShowSetup(brandNew)).toBe(true);
    expect(nextStep(brandNew)).toBe('business_type');
    expect(stepLabel('business_type')).toBe('Step 1 of 4');
    expect(stepsDone(brandNew)).toEqual([]);
  });

  it('counts connections and a saved VAT number the app already knows as done', () => {
    const facts = withFacts({ hmrcConnected: true, bankConnected: true, hasVatNumber: true });
    expect(stepsDone(facts)).toEqual(['business_type', 'vat', 'hmrc', 'bank']);
    expect(nextStep(facts)).toBeNull();
  });

  it('counts a VAT answer of "not registered" as done', () => {
    expect(stepsDone(withFacts({ setup: { vatRegistered: false } }))).toEqual(['business_type', 'vat']);
  });

  it('moves to the next step that is neither done nor skipped', () => {
    const facts = withFacts({ setup: { vatRegistered: true, skippedSteps: ['hmrc'] } });
    expect(nextStep(facts)).toBe('bank');
  });

  it('lists skipped steps as to-do items, but not once they are done', () => {
    const skipped = withFacts({ setup: { skippedSteps: ['hmrc', 'bank'] }, bankConnected: true });
    expect(todoSteps(skipped)).toEqual(['hmrc']);
  });

  it('hides the flow when every step is done or skipped', () => {
    const facts = withFacts({ setup: { skippedSteps: ['business_type', 'vat', 'hmrc', 'bank'] } });
    expect(shouldShowSetup(facts)).toBe(false);
    expect(todoSteps(facts)).toEqual(['business_type', 'vat', 'hmrc', 'bank']);
  });

  it('hides the flow once finished', () => {
    expect(shouldShowSetup(withFacts({ setup: { finishedAt: '2026-11-02T10:00:00.000Z' } }))).toBe(false);
  });

  it('keeps the step copy to one plain sentence with no banned words', () => {
    const banned = /\b(ledger|posting|journal|nominal|reconcil\w*|obligation|period key|submit|payload|endpoint|sync|token|box \d)\b/i;
    for (const step of SETUP_STEPS) {
      expect(step.purpose).toMatch(/^[^.!?]+\.$/);
      expect(`${step.title} ${step.purpose}`).not.toMatch(banned);
    }
  });
});
