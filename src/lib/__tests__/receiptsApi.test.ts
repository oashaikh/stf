import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmReceiptDraft, discardReceiptDraft, confirmReceiptUpload, readReceiptDetails, fetchReceipts, LOW_CONFIDENCE_THOUSANDTHS, removeReceipt, startReceiptUpload, uploadToSignedUrl, validateReceiptFile } from '../receiptsApi';

const respond = (status: number, body: unknown) => vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
const fileOf = (type: string, size: number, name = 'r.jpg') => ({ name, type, size }) as File;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LOW_CONFIDENCE_THOUSANDTHS', () => {
  it('is the integer 700, the extraction prompt\'s 0.7 line', () => {
    expect(LOW_CONFIDENCE_THOUSANDTHS).toBe(700);
  });
});

describe('validateReceiptFile', () => {
  it('accepts the four allowed types up to 10 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      expect(validateReceiptFile(fileOf(type, 10 * 1024 * 1024))).toBeNull();
    }
  });
  it('refuses a wrong type, an oversize file and an empty file with a clear message', () => {
    expect(validateReceiptFile(fileOf('image/gif', 10))).toMatch(/JPEG, PNG, WEBP or PDF/);
    expect(validateReceiptFile(fileOf('image/png', 10 * 1024 * 1024 + 1))).toMatch(/10 MB/);
    expect(validateReceiptFile(fileOf('image/png', 0))).toMatch(/empty/);
  });
});

describe('startReceiptUpload', () => {
  it('refuses a bad file before any request is made', async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal('fetch', fetchMock);
    await expect(startReceiptUpload(fileOf('image/gif', 10))).rejects.toThrow(/JPEG, PNG, WEBP or PDF/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('POSTs the file details and returns the receipt and upload url', async () => {
    const fetchMock = respond(200, { receipt: { id: 'r1' }, uploadUrl: 'https://s/u' });
    vi.stubGlobal('fetch', fetchMock);
    const result = await startReceiptUpload(fileOf('image/png', 5, 'a.png'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/receipts');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 5 }) });
    expect(result).toEqual({ receipt: { id: 'r1' }, uploadUrl: 'https://s/u' });
  });
  it('surfaces the server refusal message', async () => {
    vi.stubGlobal('fetch', respond(400, { error: 'Receipt needs a file name' }));
    await expect(startReceiptUpload(fileOf('image/png', 5))).rejects.toThrow('Receipt needs a file name');
  });
});

describe('fetchReceipts', () => {
  it('requests the first page bare and a later page by cursor', async () => {
    const fetchMock = respond(200, { receipts: [], nextCursor: null });
    vi.stubGlobal('fetch', fetchMock);
    await fetchReceipts();
    await fetchReceipts('c1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/receipts');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/receipts?cursor=c1');
  });
  it('throws when the list cannot load', async () => {
    vi.stubGlobal('fetch', respond(500, {}));
    await expect(fetchReceipts()).rejects.toThrow('Could not load receipts');
  });
});

describe('confirmReceiptUpload and removeReceipt', () => {
  it('PATCH and DELETE send the id', async () => {
    const fetchMock = respond(200, { receipt: { id: 'r1', uploadStatus: 'ready' } });
    vi.stubGlobal('fetch', fetchMock);
    await confirmReceiptUpload('r1');
    await removeReceipt('r1');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ id: 'r1' }) });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE', body: JSON.stringify({ id: 'r1' }) });
  });
  it('surface server refusals', async () => {
    vi.stubGlobal('fetch', respond(404, { error: 'Receipt not found' }));
    await expect(removeReceipt('r1')).rejects.toThrow('Receipt not found');
    await expect(confirmReceiptUpload('r1')).rejects.toThrow('Receipt not found');
  });
});

class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  headers: Record<string, string> = {};
  method = '';
  url = '';
  sent: unknown;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.sent = body;
  }
}

describe('uploadToSignedUrl', () => {
  it('PUTs the file with its type, reports progress and resolves on success', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const file = fileOf('image/png', 100);
    const progress: number[] = [];
    const done = uploadToSignedUrl('https://s/u', file, (percent) => progress.push(percent));
    const xhr = FakeXhr.last;
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    xhr.onload?.();
    await done;
    expect(xhr).toMatchObject({ method: 'PUT', url: 'https://s/u', sent: file });
    expect(xhr.headers['Content-Type']).toBe('image/png');
    expect(progress).toEqual([25, 100]);
  });
  it('rejects when storage refuses or the network fails', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const refused = uploadToSignedUrl('https://s/u', fileOf('image/png', 1), () => {});
    FakeXhr.last.status = 403;
    FakeXhr.last.onload?.();
    await expect(refused).rejects.toThrow(/upload/i);
    const failed = uploadToSignedUrl('https://s/u', fileOf('image/png', 1), () => {});
    FakeXhr.last.onerror?.();
    await expect(failed).rejects.toThrow(/upload/i);
  });
});

describe('readReceiptDetails', () => {
  const base = { id: 'r1', fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 1, uploadStatus: 'ready' as const, createdAt: '2026-10-30T10:00:00Z', aiStatus: 'extracted', readUrl: null };
  it('reads the amount as integer pence and flags unconfirmed details for checking', () => {
    const read = readReceiptDetails({
      ...base,
      details: { vendor: { value: 'Corner Cafe', confirmed: false, confidence: null }, totalPence: { value: '1250', confirmed: false, confidence: null }, date: { value: '2026-10-28', confirmed: false, confidence: null } },
    });
    expect(read).toMatchObject({ who: 'Corner Cafe', amountPence: 1250, date: '2026-10-28', needsCheck: true });
  });
  it('has nothing to check when no details were read, and none once confirmed', () => {
    expect(readReceiptDetails({ ...base, aiStatus: 'skipped', details: { vendor: { value: 'X', confirmed: false, confidence: 400 } } }).needsCheck).toBe(false);
    expect(readReceiptDetails({ ...base, details: {} })).toMatchObject({ who: null, amountPence: null, date: '2026-10-30T10:00:00Z', needsCheck: false });
    expect(readReceiptDetails({ ...base, details: { vendor: { value: 'X', confirmed: true, confidence: null } } }).needsCheck).toBe(false);
  });
});

describe('confirmReceiptDraft', () => {
  const edited = { id: 'r1', date: '2026-10-30', supplier: 'Cafe', grossPence: 1250, vatRatePercent: 20 as const, categoryAccountId: 'a1', description: 'Lunch' };
  it('POSTs the edited values as they are and returns the new entry id', async () => {
    const fetchMock = respond(200, { ok: true, entry: { id: 'e1' } });
    vi.stubGlobal('fetch', fetchMock);
    await expect(confirmReceiptDraft(edited)).resolves.toBe('e1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/receipt-confirm');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(edited);
  });
  it('surfaces the server refusal as a plain message', async () => {
    vi.stubGlobal('fetch', respond(409, { ok: false, error: 'This receipt is already an expense', code: 'ALREADY_CONFIRMED' }));
    await expect(confirmReceiptDraft(edited)).rejects.toThrow('This receipt is already an expense');
  });
  it('falls back to a plain message when the refusal has no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 500 })));
    await expect(confirmReceiptDraft(edited)).rejects.toThrow(/Could not save the expense/);
  });
});

describe('discardReceiptDraft', () => {
  it('DELETEs the draft by id', async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await discardReceiptDraft('r1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/receipt-confirm');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ id: 'r1' });
  });
  it('surfaces a refusal as a plain message', async () => {
    vi.stubGlobal('fetch', respond(404, { ok: false, error: 'Receipt not found', code: 'NOT_FOUND' }));
    await expect(discardReceiptDraft('r1')).rejects.toThrow('Receipt not found');
  });
});
