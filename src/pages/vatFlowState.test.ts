// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { VAT_FLOW_STEPS, clearSavedStep, finalSentence, monthRange, readSavedStep, saveStep } from './vatFlowState';

describe('monthRange', () => {
  it('words a quarter as month to month with the year once', () => {
    expect(monthRange('2026-08-01', '2026-10-31')).toBe('August to October 2026');
  });
  it('shows both years when the period crosses a year end', () => {
    expect(monthRange('2026-11-01', '2027-01-31')).toBe('November 2026 to January 2027');
  });
  it('names a single month once', () => {
    expect(monthRange('2026-08-01', '2026-08-31')).toBe('August 2026');
  });
});

describe('finalSentence', () => {
  const start = '2026-08-01';
  const end = '2026-10-31';
  it('says what you owe', () => {
    expect(finalSentence(12345, start, end)).toBe("You're telling HMRC you owe £123.45 VAT for August to October 2026.");
  });
  it('says what HMRC owes you for a negative Box 5', () => {
    expect(finalSentence(-4500, start, end)).toBe("You're telling HMRC they owe you £45.00 VAT for August to October 2026.");
  });
  it('says £0 for a nil return', () => {
    expect(finalSentence(0, start, end)).toBe("You're telling HMRC you owe £0 VAT for August to October 2026.");
  });
});

describe('saved step', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips per period key', () => {
    saveStep('26A1', 'figures');
    saveStep('26A2', 'send');
    expect(readSavedStep('26A1')).toBe('figures');
    expect(readSavedStep('26A2')).toBe('send');
  });
  it('returns null when nothing is saved', () => {
    expect(readSavedStep('26A1')).toBeNull();
  });
  it('ignores a stored value that is not a step', () => {
    localStorage.setItem('stf-vat-step:26A1', 'bogus');
    expect(readSavedStep('26A1')).toBeNull();
  });
  it('lists the steps in order', () => {
    expect(VAT_FLOW_STEPS[0]).toBe('period');
    expect(VAT_FLOW_STEPS[VAT_FLOW_STEPS.length - 1]).toBe('send');
  });
  it('forgets the saved step once cleared', () => {
    saveStep('26A1', 'send');
    clearSavedStep('26A1');
    expect(readSavedStep('26A1')).toBeNull();
  });
  it('only knows steps that a screen renders', () => {
    expect(VAT_FLOW_STEPS).toEqual(['period', 'figures', 'send']);
    localStorage.setItem('stf-vat-step:26A1', 'problems');
    expect(readSavedStep('26A1')).toBeNull();
  });
});
