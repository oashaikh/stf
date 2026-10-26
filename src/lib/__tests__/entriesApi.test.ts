import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ENTRY_FILTERS } from '../entryFilters';
import { confirmEntry, EntryRefusedError, editEntry, fetchEntries, PeriodLockedError, voidEntry } from '../entriesApi';

const respond = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchEntries', () => {
  it('sends only non-empty filters plus the cursor and returns nextCursor', async () => {
    const fetchMock = respond(200, { entries: [], nextCursor: 'c2' });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchEntries({ ...DEFAULT_ENTRY_FILTERS, kind: 'income', search: 'rent' }, 'c1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/entries?kind=income&search=rent&cursor=c1');
    expect(result).toEqual({ entries: [], nextCursor: 'c2' });
  });

  it('requests the bare path with no filters and reports no further page as null', async () => {
    const fetchMock = respond(200, { entries: [] });
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchEntries(DEFAULT_ENTRY_FILTERS)).nextCursor).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/entries');
  });
});

describe('entry changes', () => {
  it('voidEntry sends DELETE and confirmEntry sends the confirmed status', async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await voidEntry('id-1');
    await confirmEntry('id-1');
    expect(fetchMock.mock.calls[0]).toEqual(['/api/entries?id=id-1', { method: 'DELETE', credentials: 'same-origin' }]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: '{"status":"confirmed"}' });
  });

  it('maps a PERIOD_LOCKED refusal to PeriodLockedError with the server message', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'That VAT period is filed.', code: 'PERIOD_LOCKED' }));
    const failure = await voidEntry('id-1').catch((error) => error);
    expect(failure).toBeInstanceOf(PeriodLockedError);
    expect(failure.message).toBe('That VAT period is filed.');
  });

  it('keeps other refusals as EntryRefusedError with their fields', async () => {
    vi.stubGlobal('fetch', respond(400, { error: 'Invalid entry', code: 'BAD_REQUEST', fields: ['date'] }));
    const failure = await editEntry('id-1', {} as never).catch((error) => error);
    expect(failure).toBeInstanceOf(EntryRefusedError);
    expect(failure.fields).toEqual(['date']);
  });
});
