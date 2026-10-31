import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';

import { DEFAULT_ACCOUNTS } from '../../src/lib/chartOfAccounts.js';
import { accounts, auditEvents, type AccountRow } from '../../server/src/db/schema.js';
import { db } from './db.js';
import { hasControlCharacters } from './inputRules.js';

/** Explicit columns only (SEC-12). */
export type Account = Pick<AccountRow, 'id' | 'code' | 'name' | 'accountType' | 'taxCategory' | 'isSystem' | 'archivedAt'>;

export type AccountAction = 'account.create' | 'account.rename' | 'account.archive' | 'account.unarchive';

export interface NewAccount {
  code: string;
  name: string;
  accountType: Account['accountType'];
  taxCategory: string | null;
}

export type AccountChange = { name: string } | { archivedAt: Date | null };

export interface AccountStore {
  seedDefaults(userId: string): Promise<void>;
  list(userId: string, archived: boolean): Promise<Account[]>;
  get(userId: string, id: string): Promise<Account | undefined>;
  /** Throws DuplicateAccountCodeError when the code is taken. Writes the audit event atomically. */
  insert(userId: string, account: NewAccount): Promise<Account>;
  /** Undefined when no row matches (id, userId). Writes the audit event atomically. */
  update(userId: string, id: string, change: AccountChange, action: AccountAction): Promise<Account | undefined>;
}

export class DuplicateAccountCodeError extends Error {
  constructor(public readonly code: string) {
    super(`An account with code ${code} already exists`);
  }
}

export class AccountRuleError extends Error {}

export const ACCOUNT_LIST_LIMIT = 200;
const ACCOUNT_TYPES: readonly Account['accountType'][] = ['income', 'expense', 'asset', 'liability', 'equity'];
const POSTGRES_UNIQUE_VIOLATION = '23505';

export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION;

export function validateAccountName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.trim();
  return name.length >= 1 && name.length <= 100 && !hasControlCharacters(name) ? name : null;
}

export function validateAccountCode(input: unknown): string | null {
  return typeof input === 'string' && /^[A-Za-z0-9-]{1,10}$/.test(input) ? input : null;
}

export function validateNewAccount(input: unknown): NewAccount | null {
  if (typeof input !== 'object' || input === null) return null;
  const { code, name, accountType, taxCategory } = input as Record<string, unknown>;
  const validCode = validateAccountCode(code);
  const validName = validateAccountName(name);
  if (!validCode || !validName) return null;
  if (!ACCOUNT_TYPES.includes(accountType as Account['accountType'])) return null;
  if (taxCategory !== undefined && taxCategory !== null && (typeof taxCategory !== 'string' || !/^[a-z-]{1,40}$/.test(taxCategory))) {
    return null;
  }
  return { code: validCode, name: validName, accountType: accountType as Account['accountType'], taxCategory: (taxCategory as string | null | undefined) ?? null };
}

/** Seeds on first list so the login path stays free of it. */
export async function listAccounts(store: AccountStore, userId: string, archived: boolean): Promise<Account[]> {
  await store.seedDefaults(userId);
  return store.list(userId, archived);
}

/** is_system is never client-supplied: accounts created here are always user accounts. */
export const createAccount = (store: AccountStore, userId: string, account: NewAccount) => store.insert(userId, account);

export async function renameAccount(store: AccountStore, userId: string, id: string, name: string): Promise<Account | undefined> {
  return store.update(userId, id, { name }, 'account.rename');
}

export async function archiveAccount(store: AccountStore, userId: string, id: string): Promise<Account | undefined> {
  const existing = await store.get(userId, id);
  if (!existing) return undefined;
  if (existing.isSystem) throw new AccountRuleError('System accounts cannot be archived');
  return store.update(userId, id, { archivedAt: new Date() }, 'account.archive');
}

export const unarchiveAccount = (store: AccountStore, userId: string, id: string) =>
  store.update(userId, id, { archivedAt: null }, 'account.unarchive');

/** Account types are fixed after creation; a retype request is refused outright. */
export function assertNoRetype(existing: Account, requestedType: unknown): void {
  if (requestedType !== undefined && requestedType !== existing.accountType) {
    throw new AccountRuleError('Account type cannot be changed');
  }
}

const accountColumns = {
  id: accounts.id,
  code: accounts.code,
  name: accounts.name,
  accountType: accounts.accountType,
  taxCategory: accounts.taxCategory,
  isSystem: accounts.isSystem,
  archivedAt: accounts.archivedAt,
};

// Query audit: every query filters on user_id (from the session) and is served by the unique
// (user_id, code) index. Selects carry an explicit LIMIT; insert/update touch one row by (id, user_id).
export const databaseAccountStore: AccountStore = {
  async seedDefaults(userId) {
    await db
      .insert(accounts)
      .values(DEFAULT_ACCOUNTS.map((account) => ({ ...account, userId })))
      .onConflictDoNothing({ target: [accounts.userId, accounts.code] });
  },

  async list(userId, archived) {
    return db
      .select(accountColumns)
      .from(accounts)
      .where(and(eq(accounts.userId, userId), archived ? isNotNull(accounts.archivedAt) : isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.code))
      .limit(ACCOUNT_LIST_LIMIT);
  },

  async get(userId, id) {
    const [row] = await db
      .select(accountColumns)
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .limit(1);
    return row;
  },

  async insert(userId, account) {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(accounts)
          .values({ ...account, userId, isSystem: false })
          .returning(accountColumns);
        await tx.insert(auditEvents).values({
          userId,
          actorType: 'user',
          action: 'account.create',
          resourceType: 'account',
          resourceId: row.id,
          beforeSnapshot: null,
          afterSnapshot: row,
        });
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateAccountCodeError(account.code);
      throw error;
    }
  },

  async update(userId, id, change, action) {
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select(accountColumns)
        .from(accounts)
        .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
        .limit(1)
        .for('update');
      if (!before) return undefined;
      const [after] = await tx
        .update(accounts)
        .set(change)
        .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
        .returning(accountColumns);
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action,
        resourceType: 'account',
        resourceId: id,
        beforeSnapshot: before,
        afterSnapshot: after,
      });
      return after;
    });
  },
};
