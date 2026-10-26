import { describe, expect, it } from 'vitest';

import {
  LOCKOUT_MS,
  MAX_FAILURES,
  createLoginThrottle,
  lockedUntil,
  type LoginAttemptRows,
} from '../loginThrottle';

const MINUTE = 60_000;
const T0 = new Date('2026-10-26T10:00:00Z').getTime();
const at = (minutes: number) => new Date(T0 + minutes * MINUTE);

describe('lockedUntil', () => {
  it('allows 4 failures in the window', () => {
    expect(lockedUntil([at(0), at(1), at(2), at(3)], at(4))).toBeNull();
  });

  it('locks on the 5th failure until 15 minutes after the latest one', () => {
    const failures = [at(0), at(1), at(2), at(3), at(4)];
    expect(lockedUntil(failures, at(4))).toEqual(at(4 + 15));
  });

  it('lets the lock expire exactly 15 minutes after the last failure', () => {
    const failures = [at(0), at(1), at(2), at(3), at(4)];
    expect(lockedUntil(failures, at(18.9))).not.toBeNull();
    expect(lockedUntil(failures, at(19))).toBeNull();
  });

  it('ignores failures older than 15 minutes', () => {
    expect(lockedUntil([at(0), at(1), at(2), at(3), at(16)], at(16))).toBeNull();
  });

  it('exposes the policy constants', () => {
    expect(MAX_FAILURES).toBe(5);
    expect(LOCKOUT_MS).toBe(15 * MINUTE);
  });
});

function fakeRows(): LoginAttemptRows & { rows: Date[] } {
  const rows: Date[] = [];
  return {
    rows,
    async insert(attemptedAt) {
      rows.push(attemptedAt);
    },
    async latestSince(since, limit) {
      return rows
        .filter((row) => row > since)
        .sort((a, b) => b.getTime() - a.getTime())
        .slice(0, limit);
    },
    async deleteBefore(cutoff) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i] <= cutoff) rows.splice(i, 1);
    },
    async deleteAll() {
      rows.length = 0;
    },
  };
}

describe('createLoginThrottle', () => {
  it('is not locked until the 5th recorded failure', async () => {
    const rows = fakeRows();
    const throttle = createLoginThrottle(rows);
    for (let i = 0; i < 4; i++) await throttle.recordFailure(at(i));
    expect(await throttle.lockedUntil(at(4))).toBeNull();
    await throttle.recordFailure(at(4));
    expect(await throttle.lockedUntil(at(5))).toEqual(at(19));
  });

  it('clears the counter on success', async () => {
    const rows = fakeRows();
    const throttle = createLoginThrottle(rows);
    for (let i = 0; i < 5; i++) await throttle.recordFailure(at(i));
    await throttle.clear();
    expect(rows.rows).toHaveLength(0);
    expect(await throttle.lockedUntil(at(5))).toBeNull();
  });

  it('prunes rows older than the window when a failure is recorded', async () => {
    const rows = fakeRows();
    const throttle = createLoginThrottle(rows);
    await throttle.recordFailure(at(0));
    await throttle.recordFailure(at(20));
    expect(rows.rows).toEqual([at(20)]);
  });
});
