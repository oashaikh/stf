import { describe, expect, it } from 'vitest';
import { proposeMatches, type BankLine, type MatchableEntry } from './bankMatching';

const line = (id: string, date: string, amountPence: number): BankLine => ({
  id,
  date,
  amountPence,
  description: 'test line',
});
const entry = (id: string, date: string, grossPence: number): MatchableEntry => ({
  id,
  date,
  grossPence,
});

describe('proposeMatches', () => {
  it('proposes an exact match for same amount and same date', () => {
    const result = proposeMatches([line('l1', '2026-10-01', -1250)], [entry('e1', '2026-10-01', -1250)]);
    expect(result.proposals).toEqual([{ lineId: 'l1', entryId: 'e1', kind: 'exact' }]);
    expect(result.unmatchedLineIds).toEqual([]);
  });

  it('proposes a close match for same amount within 3 days', () => {
    const result = proposeMatches([line('l1', '2026-10-04', -1250)], [entry('e1', '2026-10-01', -1250)]);
    expect(result.proposals).toEqual([{ lineId: 'l1', entryId: 'e1', kind: 'close' }]);
  });

  it('proposes nothing when 4 days apart', () => {
    const result = proposeMatches([line('l1', '2026-10-05', -1250)], [entry('e1', '2026-10-01', -1250)]);
    expect(result.proposals).toEqual([]);
    expect(result.unmatchedLineIds).toEqual(['l1']);
  });

  it('never matches an income line to an expense of the same size', () => {
    const result = proposeMatches([line('l1', '2026-10-01', 1250)], [entry('e1', '2026-10-01', -1250)]);
    expect(result.proposals).toEqual([]);
  });

  it('never matches different amounts', () => {
    const result = proposeMatches([line('l1', '2026-10-01', -1250)], [entry('e1', '2026-10-01', -1251)]);
    expect(result.proposals).toEqual([]);
  });

  it('gives an entry to only one line, exact before close', () => {
    const result = proposeMatches(
      [line('a', '2026-10-02', -500), line('b', '2026-10-03', -500)],
      [entry('e1', '2026-10-03', -500)],
    );
    expect(result.proposals).toEqual([{ lineId: 'b', entryId: 'e1', kind: 'exact' }]);
    expect(result.unmatchedLineIds).toEqual(['a']);
  });

  it('picks the nearest date for a close match', () => {
    const result = proposeMatches(
      [line('l1', '2026-10-10', -500)],
      [entry('far', '2026-10-07', -500), entry('near', '2026-10-09', -500)],
    );
    expect(result.proposals).toEqual([{ lineId: 'l1', entryId: 'near', kind: 'close' }]);
  });

  it('breaks ties by id and gives the same output for any input order', () => {
    const lines = [line('l2', '2026-10-01', -500), line('l1', '2026-10-01', -500)];
    const entries = [entry('e2', '2026-10-01', -500), entry('e1', '2026-10-01', -500)];
    const expected = [
      { lineId: 'l1', entryId: 'e1', kind: 'exact' },
      { lineId: 'l2', entryId: 'e2', kind: 'exact' },
    ];
    expect(proposeMatches(lines, entries).proposals).toEqual(expected);
    expect(proposeMatches([...lines].reverse(), [...entries].reverse()).proposals).toEqual(expected);
  });

  it('handles empty input', () => {
    expect(proposeMatches([], [])).toEqual({ proposals: [], unmatchedLineIds: [] });
    expect(proposeMatches([line('l1', '2026-10-01', 100)], []).unmatchedLineIds).toEqual(['l1']);
  });

  it('leaves no unmatched lines when every line has an entry', () => {
    const result = proposeMatches(
      [line('l1', '2026-10-01', -100), line('l2', '2026-10-02', 900)],
      [entry('e1', '2026-10-02', -100), entry('e2', '2026-10-02', 900)],
    );
    expect(result.proposals).toHaveLength(2);
    expect(result.unmatchedLineIds).toEqual([]);
  });

  it('counts days across month ends', () => {
    const result = proposeMatches([line('l1', '2026-11-01', -100)], [entry('e1', '2026-10-29', -100)]);
    expect(result.proposals[0]?.kind).toBe('close');
  });
});
