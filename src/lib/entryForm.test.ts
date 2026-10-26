import { describe, expect, it } from 'vitest';
import { entryFigures, parseEntryAmount } from './entryForm';

describe('parseEntryAmount', () => {
  it('turns pounds into integer pence', () => {
    expect(parseEntryAmount('12.5')).toEqual({ pence: 1250 });
    expect(parseEntryAmount('£1,200')).toEqual({ pence: 120000 });
  });

  it.each([
    ['', 'Enter an amount'],
    ['abc', 'Enter the amount as a number, for example 12.50'],
    ['-5', 'The amount cannot be negative. Choose money in or money out instead.'],
    ['1.234', 'Use at most two decimal places, for example 12.34'],
    ['0', 'The amount must be more than £0.00'],
    ['10000001', 'The amount cannot be more than £10,000,000.00'],
  ])('refuses %j with a clear message', (input, error) => {
    expect(parseEntryAmount(input)).toEqual({ error });
  });
});

describe('entryFigures', () => {
  it('splits a gross amount into net and VAT', () => {
    expect(entryFigures(12000, 'gross', 20)).toEqual({ netPence: 10000, vatPence: 2000, grossPence: 12000 });
  });

  it('adds VAT on top of a net amount', () => {
    expect(entryFigures(10000, 'net', 20)).toEqual({ netPence: 10000, vatPence: 2000, grossPence: 12000 });
  });

  it('has no VAT at 0%', () => {
    expect(entryFigures(999, 'gross', 0)).toEqual({ netPence: 999, vatPence: 0, grossPence: 999 });
  });
});
