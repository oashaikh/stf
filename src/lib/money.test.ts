import { describe, expect, it } from 'vitest';
import { addPence, formatPence, formatPenceRaw, multiplyPence, parsePence, subtractPence, sumPence } from './money.js';

// Deterministic generator so property-style failures are reproducible.
function seededPence(count: number, max: number): number[] {
  let state = 12345;
  return Array.from({ length: count }, () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state % max;
  });
}

describe('formatPence', () => {
  it('formats zero, small and large amounts', () => {
    expect(formatPence(0)).toBe('£0.00');
    expect(formatPence(5)).toBe('£0.05');
    expect(formatPence(1299)).toBe('£12.99');
    expect(formatPence(123456789)).toBe('£1,234,567.89');
  });

  it('formats negatives with a leading minus', () => {
    expect(formatPence(-1299)).toBe('-£12.99');
  });

  it('formatPenceRaw omits the symbol and grouping', () => {
    expect(formatPenceRaw(1299)).toBe('12.99');
    expect(formatPenceRaw(100000000)).toBe('1000000.00');
  });
});

describe('parsePence', () => {
  it.each([
    ['12.99', 1299],
    ['£12.99', 1299],
    ['12', 1200],
    ['0', 0],
    ['0.00', 0],
    ['£1,234,567.89', 123456789],
    ['  £ 5.50 ', 550],
    ['.5', 50],
  ])('parses %j as %i pence', (input, expected) => {
    expect(parsePence(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '£', '-5', '-£0.01', 'Infinity', '12.99p', '1.2.3'])(
    'rejects %j',
    (input) => {
      expect(parsePence(input)).toBeNull();
    },
  );

  it('round-trips through formatPenceRaw for amounts including above £1m', () => {
    for (const pence of [0, 1, 99, 100, 1299, 99999999, 100000000, 123456789, 9999999999]) {
      expect(parsePence(formatPenceRaw(pence))).toBe(pence);
    }
  });

  it('round-trips through formatPence for non-negative amounts', () => {
    for (const pence of seededPence(500, 1_000_000_000)) {
      expect(parsePence(formatPence(pence))).toBe(pence);
    }
  });

  it('always returns an integer for fractional-pound input', () => {
    for (const pence of seededPence(500, 1_000_000)) {
      const result = parsePence(`${pence / 1000}`);
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});

describe('pence arithmetic', () => {
  it('adds, subtracts and sums exactly', () => {
    expect(addPence(10, 20)).toBe(30);
    expect(subtractPence(10, 25)).toBe(-15);
    expect(sumPence([])).toBe(0);
    expect(sumPence([1, 2, 3, -1])).toBe(5);
  });

  it('sums many awkward values without drifting (unlike 0.1 + 0.2 pounds)', () => {
    expect(sumPence(Array(1000).fill(10))).toBe(10000);
  });

  it('multiplyPence rounds half-up and stays an integer', () => {
    expect(multiplyPence(1000, 20, 100)).toBe(200);
    expect(multiplyPence(1, 1, 2)).toBe(1); // 0.5 -> 1
    expect(multiplyPence(1, 1, 3)).toBe(0);
    for (const pence of seededPence(500, 100_000_000)) {
      expect(Number.isInteger(multiplyPence(pence, 20, 120))).toBe(true);
    }
  });
});
