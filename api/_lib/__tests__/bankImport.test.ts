import { describe, expect, it } from 'vitest';

import type { BankFeedProvider, BankTransaction } from '../bankFeed';
import { importBankTransactions, type BankImportStore, type StagedBankLine } from '../bankImport';

const NOW = new Date('2026-11-01T12:00:00Z');

function fakeStore(connections = [{ id: 'c1', providerAccountId: 'acc-1', accessToken: 'tok' }]) {
  const lines: StagedBankLine[] = [];
  const store: BankImportStore = {
    async listConnections() {
      return connections;
    },
    async stagedSince(connectionId, sinceDate) {
      return lines.filter((line) => line.connectionId === connectionId && line.date >= sinceDate);
    },
    async latestDate(connectionId) {
      const dates = lines.filter((line) => line.connectionId === connectionId).map((line) => line.date);
      return dates.length ? dates.sort().at(-1)! : null;
    },
    async insertLines(newLines) {
      lines.push(...newLines);
    },
  };
  return { store, lines };
}

function fakeProvider(transactions: BankTransaction[]) {
  const sinceDates: string[] = [];
  const provider = {
    async listTransactions(_token: string, _account: string, sinceDate: string) {
      sinceDates.push(sinceDate);
      return transactions.filter((transaction) => transaction.date >= sinceDate);
    },
  } as unknown as BankFeedProvider;
  return { provider, sinceDates };
}

const tx = (id: string, date: string, amountPence: number, description = 'ACME LTD'): BankTransaction => ({ id, date, amountPence, description });

describe('importBankTransactions', () => {
  it('adds nothing when the same feed is imported twice', async () => {
    const { store, lines } = fakeStore();
    const { provider } = fakeProvider([tx('a', '2026-10-30', -1250), tx('b', '2026-10-31', 5000, 'CLIENT PAYMENT')]);
    const first = await importBankTransactions(store, provider, NOW);
    const second = await importBankTransactions(store, provider, NOW);
    expect(first.imported).toBe(2);
    expect(second.imported).toBe(0);
    expect(lines).toHaveLength(2);
  });

  it('flags a different provider id with the same date, amount and description, and keeps it', async () => {
    const { store, lines } = fakeStore();
    const { provider } = fakeProvider([tx('a', '2026-10-30', -1250), tx('b', '2026-10-30', -1250), tx('c', '2026-10-30', -1251)]);
    const summary = await importBankTransactions(store, provider, NOW);
    expect(summary).toMatchObject({ imported: 3, flagged: 1 });
    expect(lines.map((line) => [line.providerTransactionId, line.possibleDuplicate])).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
    ]);
  });

  it('stages integer pence as unmatched and resumes from the last imported date', async () => {
    const { store, lines } = fakeStore();
    const { provider, sinceDates } = fakeProvider([tx('a', '2026-10-30', -1250)]);
    await importBankTransactions(store, provider, NOW);
    await importBankTransactions(store, provider, NOW);
    expect(sinceDates).toEqual(['2026-08-03', '2026-10-30']);
    expect(lines.every((line) => Number.isInteger(line.amountPence) && line.status === 'unmatched')).toBe(true);
  });

  it('caps new lines per connection per run and picks the rest up next run', async () => {
    const { store, lines } = fakeStore();
    const many = Array.from({ length: 5 }, (_, index) => tx(`t${index}`, '2026-10-30', -100 - index));
    const { provider } = fakeProvider(many);
    const first = await importBankTransactions(store, provider, NOW, { maxLinesPerConnection: 3 });
    const second = await importBankTransactions(store, provider, NOW, { maxLinesPerConnection: 3 });
    expect([first.imported, second.imported, lines.length]).toEqual([3, 2, 5]);
  });

  it('counts a failing connection and carries on with the others', async () => {
    const { store } = fakeStore([
      { id: 'c1', providerAccountId: 'bad', accessToken: 'tok' },
      { id: 'c2', providerAccountId: 'good', accessToken: 'tok' },
    ]);
    const provider = {
      async listTransactions(_token: string, account: string) {
        if (account === 'bad') throw new Error('TrueLayer request failed (500)');
        return [tx('a', '2026-10-30', -100)];
      },
    } as unknown as BankFeedProvider;
    expect(await importBankTransactions(store, provider, NOW)).toMatchObject({ connections: 2, failed: 1, imported: 1 });
  });
});
