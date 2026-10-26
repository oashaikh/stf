import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createAccountsHandler } from '../../accounts';
import { DuplicateAccountCodeError, type Account, type AccountStore } from '../accounts';
import type { AuthDeps } from '../auth';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('accounts route', () => {
  let rows: Array<Account & { userId: string }>;
  let seedCalls: string[];
  const store: AccountStore = {
    async seedDefaults(userId) {
      seedCalls.push(userId);
      if (!rows.some((r) => r.userId === userId && r.code === '1000')) {
        rows.push({ id: uuid(rows.length + 1), userId, code: '1000', name: 'Bank', accountType: 'asset', taxCategory: null, isSystem: true, archivedAt: null });
      }
    },
    async list(userId, archived) {
      return rows.filter((r) => r.userId === userId && (r.archivedAt !== null) === archived);
    },
    async get(userId, id) {
      return rows.find((r) => r.userId === userId && r.id === id);
    },
    async insert(userId, account) {
      if (rows.some((r) => r.userId === userId && r.code === account.code)) throw new DuplicateAccountCodeError(account.code);
      const row = { ...account, id: uuid(rows.length + 1), userId, isSystem: false, archivedAt: null };
      rows.push(row);
      return row;
    },
    async update(userId, id, change) {
      const row = rows.find((r) => r.userId === userId && r.id === id);
      if (!row) return undefined;
      Object.assign(row, change);
      return row;
    },
  };
  const call = (method: string, body?: unknown, userId?: string, query = '') =>
    createAccountsHandler(store, authDeps)(
      new Request(`https://app.test/api/accounts${query}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: userId ? { cookie: `stf_session=tok-${userId}` } : {},
      }),
    );
  const newAccount = { code: '7000', name: 'Gifts', accountType: 'expense', taxCategory: 'other-allowable' };

  beforeEach(() => {
    rows = [];
    seedCalls = [];
  });

  it.each(['GET', 'POST', 'PATCH'])('refuses %s without a token', async (method) => {
    expect((await call(method, method === 'GET' ? undefined : {})).status).toBe(401);
  });

  it('refuses other methods', async () => {
    expect((await call('DELETE', undefined, 'u1')).status).toBe(405);
  });

  it('seeds defaults on the first GET', async () => {
    const body = await (await call('GET', undefined, 'u1')).json();
    expect(seedCalls).toEqual(['u1']);
    expect(body.accounts.map((a: Account) => a.code)).toEqual(['1000']);
  });

  it('returns 409 with a clear message for a duplicate code', async () => {
    expect((await call('POST', newAccount, 'u1')).status).toBe(200);
    const response = await call('POST', newAccount, 'u1');
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('7000');
  });

  it('refuses invalid input and ignores a client-supplied user id', async () => {
    expect((await call('POST', { ...newAccount, code: '' }, 'u1')).status).toBe(400);
    await call('POST', { ...newAccount, userId: 'u2' }, 'u1');
    expect(rows.find((r) => r.code === '7000')?.userId).toBe('u1');
  });

  it('hides an archived account from the default list and shows it with ?archived=true', async () => {
    const { account } = await (await call('POST', newAccount, 'u1')).json();
    expect((await call('PATCH', { id: account.id, archived: true }, 'u1')).status).toBe(200);
    const active = await (await call('GET', undefined, 'u1')).json();
    expect(active.accounts.map((a: Account) => a.id)).not.toContain(account.id);
    const archived = await (await call('GET', undefined, 'u1', '?archived=true')).json();
    expect(archived.accounts.map((a: Account) => a.id)).toEqual([account.id]);
  });

  it('refuses archiving or retyping a system account but allows renaming it', async () => {
    await call('GET', undefined, 'u1');
    const system = rows[0];
    expect((await call('PATCH', { id: system.id, archived: true }, 'u1')).status).toBe(403);
    expect((await call('PATCH', { id: system.id, name: 'Bank', accountType: 'income' }, 'u1')).status).toBe(403);
    const renamed = await call('PATCH', { id: system.id, name: 'Current account' }, 'u1');
    expect(renamed.status).toBe(200);
    expect(system.name).toBe('Current account');
  });

  it("refuses another user's account id", async () => {
    const { account } = await (await call('POST', newAccount, 'u1')).json();
    const response = await call('PATCH', { id: account.id, name: 'Mine now' }, 'u2');
    expect(response.status).toBe(404);
    expect((await call('PATCH', { id: account.id, archived: true }, 'u2')).status).toBe(404);
    expect(rows.find((r) => r.id === account.id)).toMatchObject({ name: 'Gifts', archivedAt: null });
  });

  it('refuses a PATCH id that is not a uuid', async () => {
    expect((await call('PATCH', { id: 'nope', name: 'x' }, 'u1')).status).toBe(400);
  });
});
