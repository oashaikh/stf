import * as OTPAuth from 'otpauth';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  RECOVERY_CODE_COUNT,
  createTotpService,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyCode,
  type TotpRows,
} from '../totp';

const NOW = new Date('2026-10-26T10:00:10Z');
const STEP_MS = 30_000;
const stepOf = (date: Date) => Math.floor(date.getTime() / STEP_MS);

function codeAt(secret: string, date: Date): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate({
    timestamp: date.getTime(),
  });
}

function fakeRows(): TotpRows & { stored: { secretEncrypted: string | null; recoveryHashes: Map<string, boolean> } } {
  const state = {
    secretEncrypted: null as string | null,
    enabledAt: null as Date | null,
    lastStep: null as number | null,
    recoveryHashes: new Map<string, boolean>(),
  };
  return {
    stored: state,
    async find() {
      return state.secretEncrypted
        ? { secretEncrypted: state.secretEncrypted, enabledAt: state.enabledAt, lastStep: state.lastStep }
        : null;
    },
    async saveSecret(_userId, secretEncrypted) {
      state.secretEncrypted = secretEncrypted;
      state.enabledAt = null;
      state.lastStep = null;
    },
    async enable(_userId, enabledAt, step, recoveryHashes) {
      state.enabledAt = enabledAt;
      state.lastStep = step;
      state.recoveryHashes = new Map(recoveryHashes.map((hash) => [hash, false]));
    },
    async advanceStep(_userId, step) {
      if (state.lastStep !== null && state.lastStep >= step) return false;
      state.lastStep = step;
      return true;
    },
    async useRecoveryHash(_userId, hash) {
      if (state.recoveryHashes.get(hash) !== false) return false;
      state.recoveryHashes.set(hash, true);
      return true;
    },
    async disable() {
      state.secretEncrypted = null;
      state.enabledAt = null;
      state.lastStep = null;
      state.recoveryHashes.clear();
    },
  };
}

beforeAll(() => {
  process.env.HMRC_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('verifyCode', () => {
  const secret = generateSecret();

  it('returns the time step for the current code', () => {
    expect(verifyCode(secret, codeAt(secret, NOW), NOW)).toBe(stepOf(NOW));
  });

  it('accepts one step either side and returns that step', () => {
    const before = new Date(NOW.getTime() - STEP_MS);
    const after = new Date(NOW.getTime() + STEP_MS);
    expect(verifyCode(secret, codeAt(secret, before), NOW)).toBe(stepOf(before));
    expect(verifyCode(secret, codeAt(secret, after), NOW)).toBe(stepOf(after));
  });

  it('rejects an expired code two steps old', () => {
    const old = new Date(NOW.getTime() - 2 * STEP_MS);
    expect(verifyCode(secret, codeAt(secret, old), NOW)).toBeNull();
  });

  it('rejects a wrong or malformed code', () => {
    const right = codeAt(secret, NOW);
    const wrong = right === '000000' ? '000001' : '000000';
    expect(verifyCode(secret, wrong, NOW)).toBeNull();
    expect(verifyCode(secret, '12345', NOW)).toBeNull();
    expect(verifyCode(secret, 'abcdef', NOW)).toBeNull();
  });
});

describe('otpauthUri', () => {
  it('is a 6 digit, 30 second SHA1 totp uri carrying the secret', () => {
    const secret = generateSecret();
    const uri = otpauthUri(secret, 'STF');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
    expect(uri).toContain('algorithm=SHA1');
  });
});

describe('recovery codes', () => {
  it('generates 8 distinct codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it('hashes deterministically without containing the code', () => {
    const [code] = generateRecoveryCodes();
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode(code)).not.toContain(code);
    expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('createTotpService', () => {
  it('stores the secret encrypted, not as plaintext', async () => {
    const rows = fakeRows();
    const secret = generateSecret();
    await createTotpService(rows).begin('u1', secret);
    expect(rows.stored.secretEncrypted).not.toBeNull();
    expect(rows.stored.secretEncrypted).not.toContain(secret);
  });

  it('enables only after a correct code and stores recovery hashes only', async () => {
    const rows = fakeRows();
    const service = createTotpService(rows);
    const secret = generateSecret();
    await service.begin('u1', secret);
    expect(await service.confirm('u1', '000000', NOW)).toBeNull();
    expect(rows.stored.recoveryHashes.size).toBe(0);

    const codes = await service.confirm('u1', codeAt(secret, NOW), NOW);
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect([...rows.stored.recoveryHashes.keys()].sort()).toEqual(codes!.map(hashRecoveryCode).sort());
    for (const code of codes!) expect(rows.stored.recoveryHashes.has(code)).toBe(false);
  });

  it('refuses a code from a step that was already used', async () => {
    const rows = fakeRows();
    const service = createTotpService(rows);
    const secret = generateSecret();
    await service.begin('u1', secret);
    await service.confirm('u1', codeAt(secret, NOW), NOW);

    expect(await service.verifyLogin('u1', codeAt(secret, NOW), NOW)).toBe(false);
    const next = new Date(NOW.getTime() + STEP_MS);
    expect(await service.verifyLogin('u1', codeAt(secret, next), next)).toBe(true);
    expect(await service.verifyLogin('u1', codeAt(secret, next), next)).toBe(false);
  });

  it('refuses login when no second factor is enabled', async () => {
    const rows = fakeRows();
    const service = createTotpService(rows);
    const secret = generateSecret();
    await service.begin('u1', secret);
    expect(await service.verifyLogin('u1', codeAt(secret, NOW), NOW)).toBe(false);
  });

  it('accepts each recovery code once', async () => {
    const rows = fakeRows();
    const service = createTotpService(rows);
    const secret = generateSecret();
    await service.begin('u1', secret);
    const codes = (await service.confirm('u1', codeAt(secret, NOW), NOW))!;

    expect(await service.consumeRecoveryCode('u1', codes[0])).toBe(true);
    expect(await service.consumeRecoveryCode('u1', codes[0])).toBe(false);
    expect(await service.consumeRecoveryCode('u1', codes[1])).toBe(true);
    expect(await service.consumeRecoveryCode('u1', 'not-a-real-code')).toBe(false);
  });

  it('disable clears the secret and recovery codes', async () => {
    const rows = fakeRows();
    const service = createTotpService(rows);
    const secret = generateSecret();
    await service.begin('u1', secret);
    await service.confirm('u1', codeAt(secret, NOW), NOW);
    await service.disable('u1');
    expect(rows.stored.secretEncrypted).toBeNull();
    expect(rows.stored.recoveryHashes.size).toBe(0);
  });
});
