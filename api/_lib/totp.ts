import { createHash, randomBytes } from 'node:crypto';

import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

import { decryptToken, encryptToken } from '../../server/src/lib/hmrcCrypto.js';

const PERIOD_SECONDS = 30;
const DIGITS = 6;
export const RECOVERY_CODE_COUNT = 8;

export function generateSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function otpauthUri(secret: string, issuer: string): string {
  return new OTPAuth.TOTP({
    issuer,
    label: 'Owner',
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD_SECONDS,
  }).toString();
}

/** Rendered server-side so the secret never goes through a third-party QR service. */
export function qrCodeDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

/** The matched time step (one step either side allowed for clock drift), or null if the code is wrong. */
export function verifyCode(secret: string, code: string, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD_SECONDS,
  });
  const delta = totp.validate({ token: code, timestamp: now.getTime(), window: 1 });
  return delta === null ? null : Math.floor(now.getTime() / 1000 / PERIOD_SECONDS) + delta;
}

/** 10 random bytes (80 bits), shown as two hyphenated halves for typing. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const hex = randomBytes(10).toString('hex');
    return `${hex.slice(0, 10)}-${hex.slice(10)}`;
  });
}

// A plain SHA-256 is enough: the codes carry 80 random bits, so there is nothing for a slow KDF to protect.
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

// Retention (DP-6): the secret and recovery rows are credentials, not financial records. They live
// until the second factor is disabled, which deletes them; a used recovery code stays, marked used_at.
export interface TotpRows {
  find(userId: string): Promise<{ secretEncrypted: string; enabledAt: Date | null; lastStep: number | null } | null>;
  /** Stores a not-yet-enabled secret, replacing any earlier one. */
  saveSecret(userId: string, secretEncrypted: string): Promise<void>;
  enable(userId: string, enabledAt: Date, step: number, recoveryHashes: string[]): Promise<void>;
  /** Atomically moves last_step forward; false when `step` is not newer, so a code works once. */
  advanceStep(userId: string, step: number): Promise<boolean>;
  /** Atomically marks an unused recovery code used; false when unknown or already used. */
  useRecoveryHash(userId: string, codeHash: string): Promise<boolean>;
  disable(userId: string): Promise<void>;
}

export function createTotpService(rows: TotpRows) {
  return {
    async begin(userId: string, secret: string): Promise<void> {
      await rows.saveSecret(userId, encryptToken(secret));
    },
    /** Returns the recovery codes (shown once) when the code is right, otherwise null. */
    async confirm(userId: string, code: string, now: Date): Promise<string[] | null> {
      const found = await rows.find(userId);
      if (!found || found.enabledAt) return null;
      const step = verifyCode(decryptToken(found.secretEncrypted), code, now);
      if (step === null) return null;
      const codes = generateRecoveryCodes();
      await rows.enable(userId, now, step, codes.map(hashRecoveryCode));
      return codes;
    },
    async isEnabled(userId: string): Promise<boolean> {
      return Boolean((await rows.find(userId))?.enabledAt);
    },
    async verifyLogin(userId: string, code: string, now: Date): Promise<boolean> {
      const found = await rows.find(userId);
      if (!found?.enabledAt) return false;
      const step = verifyCode(decryptToken(found.secretEncrypted), code, now);
      if (step === null) return false;
      return rows.advanceStep(userId, step);
    },
    consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
      return rows.useRecoveryHash(userId, hashRecoveryCode(code));
    },
    disable(userId: string): Promise<void> {
      return rows.disable(userId);
    },
  };
}
