import { describe, expect, it } from 'vitest';
import { consentState } from './bankApi';

const now = new Date('2026-11-01T12:00:00Z');
const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

describe('consentState', () => {
  it('is active with more than 14 days left', () => {
    expect(consentState(inDays(15), now)).toBe('active');
  });

  it('is expiring at exactly 14 days left', () => {
    expect(consentState(inDays(14), now)).toBe('expiring');
  });

  it('is expiring with one day left', () => {
    expect(consentState(inDays(1), now)).toBe('expiring');
  });

  it('is expired once the expiry time has passed', () => {
    expect(consentState(inDays(-1), now)).toBe('expired');
    expect(consentState(now.toISOString(), now)).toBe('expired');
  });
});
