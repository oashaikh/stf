import { describe, expect, it } from 'vitest';

import { formatQuantity, formTotals, parseQuantityScaled, parseUnitPricePence, toDraftRequest, type InvoiceFormState } from './invoiceForm';

const form: InvoiceFormState = {
  clientName: 'Acme Ltd',
  clientEmail: '',
  clientAddress: '',
  issueDate: '2026-05-01',
  dueDate: '2026-05-31',
  notes: '',
  lines: [
    { description: 'Design', quantity: '1.5', unitPrice: '100.00', vatRatePercent: 20 },
    { description: 'Hosting', quantity: '2', unitPrice: '0.99', vatRatePercent: 0 },
  ],
};

describe('parseQuantityScaled', () => {
  it('scales up to four decimals without a float', () => {
    expect(parseQuantityScaled('1.5')).toBe(15000);
    expect(parseQuantityScaled('0.0001')).toBe(1);
    expect(parseQuantityScaled('3')).toBe(30000);
  });
  it.each(['', '0', 'abc', '-1', '1.00001', '1e3'])('rejects %j', (input) => {
    expect(parseQuantityScaled(input)).toBeNull();
  });
});

describe('parseUnitPricePence', () => {
  it('reads pounds and pence as integer pence', () => {
    expect(parseUnitPricePence('12.5')).toBe(1250);
    expect(parseUnitPricePence('£1,000')).toBe(100000);
    expect(parseUnitPricePence('0')).toBe(0);
  });
  it.each(['', '1.234', '-2', 'x'])('rejects %j', (input) => {
    expect(parseUnitPricePence(input)).toBeNull();
  });
});

describe('formTotals', () => {
  it('sums line maths and charges VAT only for a VAT-registered owner', () => {
    expect(formTotals(form, true)).toEqual({ netPence: 15198, vatPence: 3000, totalPence: 18198 });
    expect(formTotals(form, false)).toEqual({ netPence: 15198, vatPence: 0, totalPence: 15198 });
  });
  it('skips lines that do not parse yet', () => {
    expect(formTotals({ ...form, lines: [{ description: '', quantity: 'x', unitPrice: '', vatRatePercent: 20 }] }, true).totalPence).toBe(0);
  });
});

describe('toDraftRequest', () => {
  it('maps the form to the API body with scaled quantity and pence', () => {
    const result = toDraftRequest(form);
    expect(result.errors).toEqual({});
    expect(result.body?.lines[0]).toEqual({ description: 'Design', quantity: 15000, unitPricePence: 10000, vatRatePercent: 20 });
  });
  it('reports each missing or invalid field', () => {
    const { body, errors } = toDraftRequest({ ...form, clientName: ' ', dueDate: '2026-04-01', lines: [{ description: '', quantity: '0', unitPrice: 'x', vatRatePercent: 20 }] });
    expect(body).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['clientName', 'dueDate', 'lines']);
  });
});

describe('formatQuantity', () => {
  it('turns scaled quantity back into the text a person typed', () => {
    expect(formatQuantity(15000)).toBe('1.5');
    expect(formatQuantity(30000)).toBe('3');
    expect(formatQuantity(1)).toBe('0.0001');
  });
});
