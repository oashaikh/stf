import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { InvoiceRuleError, assertPaymentDateAllowed, deriveInvoiceStatus } from '../invoices';

const now = new Date('2026-10-27T10:00:00Z');

describe('assertPaymentDateAllowed', () => {
  it('accepts the issue date, today and the furthest allowed future day', () => {
    expect(() => assertPaymentDateAllowed('2026-10-01', '2026-10-01', now)).not.toThrow();
    expect(() => assertPaymentDateAllowed('2026-10-01', '2026-10-27', now)).not.toThrow();
    expect(() => assertPaymentDateAllowed('2026-10-01', '2026-11-03', now)).not.toThrow();
  });

  it('refuses a payment date before the issue date', () => {
    expect(() => assertPaymentDateAllowed('2026-10-01', '2026-09-30', now)).toThrow(InvoiceRuleError);
  });

  it('refuses a payment date more than 7 days ahead', () => {
    expect(() => assertPaymentDateAllowed('2026-10-01', '2026-11-04', now)).toThrow(InvoiceRuleError);
  });
});

describe('deriveInvoiceStatus', () => {
  it('shows a sent invoice past its due date as overdue', () => {
    expect(deriveInvoiceStatus('sent', '2026-10-26', '2026-10-27')).toBe('overdue');
  });

  it('keeps sent on the due date itself, and never changes other statuses', () => {
    expect(deriveInvoiceStatus('sent', '2026-10-27', '2026-10-27')).toBe('sent');
    expect(deriveInvoiceStatus('paid', '2026-01-01', '2026-10-27')).toBe('paid');
    expect(deriveInvoiceStatus('draft', '2026-01-01', '2026-10-27')).toBe('draft');
  });
});
