import { describe, expect, it } from 'vitest';

import {
  LOCKOUT_MS,
  MAX_FAILURES,
  clientKey,
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

function fakeRows(): LoginAttemptRows & { rows: { clientKey: string; at: Date }[] } {
  const rows: { clientKey: string; at: Date }[] = [];
  return {
    rows,
    async insert(key, attemptedAt) {
      rows.push({ clientKey: key, at: attemptedAt });
    },
    async latestSince(key, since, limit) {
      return rows
        .filter((row) => row.clientKey === key && row.at > since)
        .map((row) => row.at)
        .sort((a, b) => b.getTime() - a.getTime())
        .slice(0, limit);
    },
    async deleteBefore(cutoff) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].at <= cutoff) rows.splice(i, 1);
    },
    async deleteForClient(key) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].clientKey === key) rows.splice(i, 1);
    },
  };
}

describe('createLoginThrottle', () => {
  it('is not locked until the 5th recorded failure', async () => {
    const throttle = createLoginThrottle(fakeRows());
    for (let i = 0; i < 4; i++) await throttle.recordFailure('a', at(i));
    expect(await throttle.lockedUntil('a', at(4))).toBeNull();
    await throttle.recordFailure('a', at(4));
    expect(await throttle.lockedUntil('a', at(5))).toEqual(at(19));
  });

  it('keeps one client from locking out another', async () => {
    const throttle = createLoginThrottle(fakeRows());
    for (let i = 0; i < 5; i++) await throttle.recordFailure('attacker', at(i));
    expect(await throttle.lockedUntil('attacker', at(5))).not.toBeNull();
    expect(await throttle.lockedUntil('owner', at(5))).toBeNull();
  });

  it('clears only the calling client on success', async () => {
    const rows = fakeRows();
    const throttle = createLoginThrottle(rows);
    for (let i = 0; i < 5; i++) await throttle.recordFailure('a', at(i));
    await throttle.recordFailure('b', at(5));
    await throttle.clear('a');
    expect(rows.rows.map((row) => row.clientKey)).toEqual(['b']);
    expect(await throttle.lockedUntil('a', at(5))).toBeNull();
  });

  it('prunes rows older than the window when a failure is recorded', async () => {
    const rows = fakeRows();
    const throttle = createLoginThrottle(rows);
    await throttle.recordFailure('a', at(0));
    await throttle.recordFailure('a', at(20));
    expect(rows.rows.map((row) => row.at)).toEqual([at(20)]);
  });
});

describe('clientKey', () => {
  const keyFor = (headers: Record<string, string>) => clientKey(new Request('https://x.test', { headers }));

  it('uses the platform-set client address and ignores a client-supplied x-forwarded-for', () => {
    const real = keyFor({ 'x-vercel-forwarded-for': '203.0.113.7' });
    expect(keyFor({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' })).toBe(real);
    expect(keyFor({ 'x-vercel-forwarded-for': '203.0.113.8' })).not.toBe(real);
  });

  it('falls back to one shared bucket when no trusted address is present', () => {
    expect(keyFor({ 'x-forwarded-for': '198.51.100.1' })).toBe(keyFor({ 'x-forwarded-for': '198.51.100.2' }));
  });

  it('does not store the raw address', () => {
    expect(keyFor({ 'x-vercel-forwarded-for': '203.0.113.7' })).not.toContain('203.0.113.7');
  });
});
