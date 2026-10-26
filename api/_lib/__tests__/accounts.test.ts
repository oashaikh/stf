import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { DEFAULT_ACCOUNTS } from '../../../src/lib/chartOfAccounts';
import {
  AccountRuleError,
  DuplicateAccountCodeError,
  archiveAccount,
  assertNoRetype,
  createAccount,
  isUniqueViolation,
  listAccounts,
  renameAccount,
  validateAccountCode,
  validateAccountName,
  validateNewAccount,
  type Account,
  type AccountStore,
} from '../accounts';

interface AuditEntry {
  userId: string;
  action: string;
  before: Account | null;
  after: Account | undefined;
}

function fakeStore() {
  const rows = new Map<string, Account & { userId: string }>();
  const audit: AuditEntry[] = [];
  let nextId = 1;
  const store: AccountStore = {
    async seedDefaults(userId) {
      for (const d of DEFAULT_ACCOUNTS) {
        if ([...rows.values()].some((r) => r.userId === userId && r.code === d.code)) continue;
        const id = `acc-${nextId++}`;
        rows.set(id, { ...d, id, userId, archivedAt: null });
      }
    },
    async list(userId, archived) {
      return [...rows.values()]
        .filter((r) => r.userId === userId && (r.archivedAt !== null) === archived)
        .sort((a, b) => a.code.localeCompare(b.code));
    },
    async get(userId, id) {
      const row = rows.get(id);
      return row?.userId === userId ? row : undefined;
    },
    async insert(userId, account) {
      if ([...rows.values()].some((r) => r.userId === userId && r.code === account.code)) {
        throw new DuplicateAccountCodeError(account.code);
      }
      const id = `acc-${nextId++}`;
      const row = { ...account, id, userId, isSystem: false, archivedAt: null };
      rows.set(id, row);
      audit.push({ userId, action: 'account.create', before: null, after: row });
      return row;
    },
    async update(userId, id, change, action) {
      const before = rows.get(id);
      if (before?.userId !== userId) return undefined;
      const after = { ...before, ...change };
      rows.set(id, after);
      audit.push({ userId, action, before, after });
      return after;
    },
  };
  return { store, audit };
}

const newTravel = { code: '6700', name: 'Parking', accountType: 'expense' as const, taxCategory: 'travel' };

describe('listAccounts', () => {
  it('seeding twice leaves exactly one copy of each default', async () => {
    const { store } = fakeStore();
    await listAccounts(store, 'u1', false);
    const second = await listAccounts(store, 'u1', false);
    expect(second).toHaveLength(DEFAULT_ACCOUNTS.length);
    expect(new Set(second.map((a) => a.code)).size).toBe(DEFAULT_ACCOUNTS.length);
  });

  it('archived account leaves the default list and shows in the archived list', async () => {
    const { store } = fakeStore();
    const created = await createAccount(store, 'u1', newTravel);
    await archiveAccount(store, 'u1', created.id);
    expect((await listAccounts(store, 'u1', false)).map((a) => a.id)).not.toContain(created.id);
    expect((await listAccounts(store, 'u1', true)).map((a) => a.id)).toEqual([created.id]);
  });

  it("does not show another user's accounts", async () => {
    const { store } = fakeStore();
    await createAccount(store, 'u1', newTravel);
    const other = await listAccounts(store, 'u2', false);
    expect(other.every((a) => a.code !== '6700')).toBe(true);
  });
});

describe('createAccount', () => {
  it('refuses a duplicate code with a typed error', async () => {
    const { store } = fakeStore();
    await createAccount(store, 'u1', newTravel);
    await expect(createAccount(store, 'u1', newTravel)).rejects.toBeInstanceOf(DuplicateAccountCodeError);
  });

  it('writes an audit event with an after snapshot', async () => {
    const { store, audit } = fakeStore();
    const created = await createAccount(store, 'u1', newTravel);
    expect(audit).toEqual([{ userId: 'u1', action: 'account.create', before: null, after: created }]);
  });
});

describe('renameAccount', () => {
  it('audits before and after snapshots', async () => {
    const { store, audit } = fakeStore();
    const created = await createAccount(store, 'u1', newTravel);
    await renameAccount(store, 'u1', created.id, 'Car parking');
    const entry = audit.at(-1);
    expect(entry?.action).toBe('account.rename');
    expect(entry?.before?.name).toBe('Parking');
    expect(entry?.after?.name).toBe('Car parking');
  });

  it("refuses another user's account id", async () => {
    const { store } = fakeStore();
    const created = await createAccount(store, 'u1', newTravel);
    expect(await renameAccount(store, 'u2', created.id, 'Mine now')).toBeUndefined();
    expect((await store.get('u1', created.id))?.name).toBe('Parking');
  });
});

describe('archiveAccount', () => {
  it('refuses to archive a system account', async () => {
    const { store, audit } = fakeStore();
    const [bank] = await listAccounts(store, 'u1', false);
    expect(bank.isSystem).toBe(true);
    await expect(archiveAccount(store, 'u1', bank.id)).rejects.toBeInstanceOf(AccountRuleError);
    expect(audit).toHaveLength(0);
  });

  it('audits before and after snapshots', async () => {
    const { store, audit } = fakeStore();
    const created = await createAccount(store, 'u1', newTravel);
    await archiveAccount(store, 'u1', created.id);
    expect(audit.at(-1)?.before?.archivedAt).toBeNull();
    expect(audit.at(-1)?.after?.archivedAt).toBeInstanceOf(Date);
  });

  it("refuses another user's account id", async () => {
    const { store } = fakeStore();
    const created = await createAccount(store, 'u1', newTravel);
    expect(await archiveAccount(store, 'u2', created.id)).toBeUndefined();
    expect((await store.get('u1', created.id))?.archivedAt).toBeNull();
  });
});

describe('pure rules', () => {
  const existing = { ...newTravel, id: 'a', isSystem: true, archivedAt: null } as Account;

  it('refuses a retype but allows the same type', () => {
    expect(() => assertNoRetype(existing, 'income')).toThrow(AccountRuleError);
    expect(() => assertNoRetype(existing, 'expense')).not.toThrow();
    expect(() => assertNoRetype(existing, undefined)).not.toThrow();
  });

  it('maps only Postgres 23505 to a unique violation', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('validates names, codes and new accounts', () => {
    expect(validateAccountName('  Parking ')).toBe('Parking');
    expect(validateAccountName('   ')).toBeNull();
    expect(validateAccountName('x'.repeat(101))).toBeNull();
    expect(validateAccountName(5)).toBeNull();
    expect(validateAccountCode('6700')).toBe('6700');
    expect(validateAccountCode('6 7')).toBeNull();
    expect(validateAccountCode('12345678901')).toBeNull();
    expect(validateNewAccount(newTravel)).toEqual(newTravel);
    expect(validateNewAccount({ ...newTravel, accountType: 'bogus' })).toBeNull();
    expect(validateNewAccount({ ...newTravel, taxCategory: 'Bad Slug' })).toBeNull();
    expect(validateNewAccount({ ...newTravel, isSystem: true })).toEqual(newTravel);
    expect(validateNewAccount(null)).toBeNull();
  });
});
