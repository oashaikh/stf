import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ where: undefined as unknown, limit: undefined as unknown, columns: undefined as unknown }));
vi.mock('../db', () => {
  const chain: Record<string, unknown> = {};
  chain.select = (columns: unknown) => ((captured.columns = columns), chain);
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = (condition: unknown) => ((captured.where = condition), chain);
  chain.orderBy = () => chain;
  chain.limit = async (limit: number) => ((captured.limit = limit), []);
  return { db: chain };
});

import { summariseLedger } from '../../../src/lib/dashboardSummary';
import {
  buildCsv,
  databaseExportStore,
  EXPORT_ROW_LIMIT,
  parseExportRange,
  TOO_LARGE_MESSAGE,
  type ExportLine,
} from '../entriesExport';

const line = (overrides: Partial<ExportLine> = {}): ExportLine => ({
  date: '2026-05-01',
  description: 'Consulting',
  reference: 'INV-1',
  accountCode: '4000',
  accountName: 'Sales',
  amountPence: -10000,
  vatPence: -2000,
  status: 'confirmed',
  source: 'manual',
  ...overrides,
});

const read = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text();

describe('buildCsv', () => {
  it('writes the header and pounds with two decimals, gross as net plus VAT', async () => {
    const csv = await read(buildCsv([line(), line({ amountPence: 0, vatPence: 0 }), line({ amountPence: 5, vatPence: 1 })]));
    expect(csv.split('\r\n')).toEqual([
      'date,description,reference,account code,account name,net,VAT,gross,status,source',
      '2026-05-01,Consulting,INV-1,4000,Sales,-100.00,-20.00,-120.00,confirmed,manual',
      '2026-05-01,Consulting,INV-1,4000,Sales,0.00,0.00,0.00,confirmed,manual',
      '2026-05-01,Consulting,INV-1,4000,Sales,0.05,0.01,0.06,confirmed,manual',
      '',
    ]);
  });

  it('quotes commas, quotes and newlines', async () => {
    const csv = await read(buildCsv([line({ description: 'a, "b"\nc', reference: null })]));
    expect(csv).toContain('"a, ""b""\nc",,4000');
  });

  it('neutralises text cells that start with = + - @ but leaves money alone', async () => {
    const csv = await read(buildCsv([line({ description: '=SUM(A1)', reference: '+1', accountName: '-x', source: '@y' })]));
    expect(csv).toContain(`'=SUM(A1),'+1,4000,'-x,-100.00,-20.00,-120.00,confirmed,'@y`);
  });

  it('streams past one chunk without losing rows', async () => {
    const csv = await read(buildCsv(Array.from({ length: 1200 }, () => line())));
    expect(csv.split('\r\n')).toHaveLength(1202);
  });

  it('income and expense totals match the profit and loss summary for the same range', async () => {
    const lines = [
      line({ amountPence: -100000, vatPence: -20000 }),
      line({ accountCode: '5000', accountName: 'Travel', amountPence: 4000, vatPence: 800 }),
      line({ status: 'reconciled', amountPence: -50000, vatPence: 0 }),
      line({ status: 'draft', amountPence: -999900, vatPence: 0 }),
    ];
    const rows = (await read(buildCsv(lines))).trim().split('\r\n').slice(1).map((row) => row.split(','));
    const statusOf = (row: string[]) => row[8];
    const toPence = (pounds: string) => Math.round(Number(pounds) * 100);
    let income = 0;
    let expenses = 0;
    for (const row of rows) {
      if (statusOf(row) === 'draft') continue;
      const net = toPence(row[5]);
      if (row[3].startsWith('4')) income -= net;
      else expenses += net;
    }
    const totals = summariseLedger(
      lines.map((l) => ({ ...l, accountType: l.accountCode.startsWith('4') ? 'income' : 'expense', deletedAt: null }) as never),
      { start: '2026-05-01', end: '2026-05-31' },
    );
    expect(income).toBe(totals.incomePence);
    expect(expenses).toBe(totals.expensesPence);
  });
});

describe('parseExportRange', () => {
  const parse = (query: string) => parseExportRange(new URLSearchParams(query));

  it('accepts a valid range, including the 366 day cap', () => {
    expect(parse('from=2026-04-06&to=2027-04-05')).toEqual({ from: '2026-04-06', to: '2027-04-05' });
    expect(parse('from=2026-05-01&to=2026-05-01')).toEqual({ from: '2026-05-01', to: '2026-05-01' });
  });

  it('refuses a range over the cap with a plain message', () => {
    expect(parse('from=2026-01-01&to=2027-01-02')).toEqual({ error: TOO_LARGE_MESSAGE, code: 'RANGE_TOO_LARGE' });
  });

  it.each(['from=2026-05-02&to=2026-05-01', 'from=2026-13-01&to=2026-12-01', 'from=2026-02-30&to=2026-03-01', 'from=nope&to=2026-05-01', 'to=2026-05-01'])(
    'refuses %s',
    (query) => {
      expect(parse(query)).toMatchObject({ code: 'INVALID_RANGE' });
    },
  );
});

describe('databaseExportStore', () => {
  it('filters on the session user, excludes deleted entries and asks for a bounded result', async () => {
    await databaseExportStore.loadExportLines('owner-1', '2026-05-01', '2026-05-31', EXPORT_ROW_LIMIT + 1);
    const { sql, params } = new PgDialect().sqlToQuery(captured.where as never);
    expect(sql).toContain('"transactions"."user_id" = $1');
    expect(sql).toContain('"transactions"."deleted_at" is null');
    expect(params).toEqual(['owner-1', '2026-05-01', '2026-05-31']);
    expect(captured.limit).toBe(EXPORT_ROW_LIMIT + 1);
  });
});
