import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HmrcError, type HmrcTokenSet } from '../../../src/lib/hmrc/client';
import { decryptToken, encryptToken } from '../lib/hmrcCrypto';
import { REFRESH_BATCH_LIMIT, REFRESH_WINDOW_MS, refreshDueTokens, type DueUser, type RefreshStore } from './refreshHmrcTokens';

const NOW = new Date('2026-10-26T12:00:00Z');

function fakeStore(due: DueUser[], currentRefreshTokens: Record<string, string | null> = {}) {
  const saved: Record<string, { accessToken: string; refreshToken: string; expiresAt: Date }> = {};
  const cleared: string[] = [];
  const store: RefreshStore = {
    findDue: vi.fn(async () => due),
    // Mirrors the SQL guard: write only while the stored refresh token is still the one we read.
    saveTokens: vi.fn(async (id, previous, tokens) => {
      if ((currentRefreshTokens[id] ?? previous) === previous) saved[id] = tokens;
    }),
    clearTokens: vi.fn(async (id) => {
      cleared.push(id);
    }),
  };
  return { store, saved, cleared };
}

function tokenSet(suffix: string): HmrcTokenSet {
  return { accessToken: `access-${suffix}`, refreshToken: `refresh-${suffix}`, expiresAt: NOW.getTime() + 4 * 3600_000 };
}

describe('refreshDueTokens', () => {
  beforeEach(() => {
    process.env.HMRC_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  it('queries once with the window cutoff and limit, and stores refreshed tokens as ciphertext', async () => {
    const due = [{ id: 'u1', refreshToken: encryptToken('old-1') }];
    const { store, saved } = fakeStore(due);
    const refresh = vi.fn(async () => tokenSet('1'));

    await refreshDueTokens({ store, refresh, now: () => NOW });

    expect(store.findDue).toHaveBeenCalledTimes(1);
    expect(store.findDue).toHaveBeenCalledWith(new Date(NOW.getTime() + REFRESH_WINDOW_MS), REFRESH_BATCH_LIMIT);
    expect(refresh).toHaveBeenCalledWith('old-1');
    expect(saved.u1.accessToken).not.toContain('access-1');
    expect(decryptToken(saved.u1.accessToken)).toBe('access-1');
    expect(decryptToken(saved.u1.refreshToken)).toBe('refresh-1');
    expect(saved.u1.expiresAt).toEqual(new Date(tokenSet('1').expiresAt));
  });

  it('does not touch users the query did not return', async () => {
    const { store } = fakeStore([]);
    const refresh = vi.fn();
    await refreshDueTokens({ store, refresh, now: () => NOW });
    expect(refresh).not.toHaveBeenCalled();
    expect(store.saveTokens).not.toHaveBeenCalled();
  });

  it('clears tokens on invalid_grant and carries on with the rest', async () => {
    const due = [
      { id: 'u1', refreshToken: encryptToken('old-1') },
      { id: 'u2', refreshToken: encryptToken('old-2') },
    ];
    const { store, saved, cleared } = fakeStore(due);
    const refresh = vi.fn(async (token: string) => {
      if (token === 'old-1') throw new HmrcError({ code: 'invalid_grant', message: 'rejected', statusCode: 400 });
      return tokenSet('2');
    });

    await refreshDueTokens({ store, refresh, now: () => NOW });

    expect(cleared).toEqual(['u1']);
    expect(Object.keys(saved)).toEqual(['u2']);
  });

  it('keeps tokens and continues when one refresh fails for another reason, without logging a token', async () => {
    const due = [
      { id: 'u1', refreshToken: encryptToken('old-1') },
      { id: 'u2', refreshToken: encryptToken('old-2') },
    ];
    const { store, saved, cleared } = fakeStore(due);
    const logError = vi.fn();
    const refresh = vi.fn(async (token: string) => {
      if (token === 'old-1') throw new Error('network down old-1');
      return tokenSet('2');
    });

    await refreshDueTokens({ store, refresh, now: () => NOW, logError });

    expect(cleared).toEqual([]);
    expect(Object.keys(saved)).toEqual(['u2']);
    expect(JSON.stringify(logError.mock.calls)).not.toContain('old-1');
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('skips the write when the stored refresh token changed mid-run', async () => {
    const original = encryptToken('old-1');
    const { store, saved } = fakeStore([{ id: 'u1', refreshToken: original }], { u1: encryptToken('reconnected') });
    await refreshDueTokens({ store, refresh: async () => tokenSet('1'), now: () => NOW });
    expect(saved.u1).toBeUndefined();
  });

  it('survives a stored token that cannot be decrypted', async () => {
    const due = [
      { id: 'u1', refreshToken: 'garbage' },
      { id: 'u2', refreshToken: encryptToken('old-2') },
    ];
    const { store, saved } = fakeStore(due);
    await refreshDueTokens({ store, refresh: async () => tokenSet('2'), now: () => NOW, logError: vi.fn() });
    expect(Object.keys(saved)).toEqual(['u2']);
  });
});
