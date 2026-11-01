// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  confirmReceiptUpload,
  fetchReceipts,
  removeReceipt,
  startReceiptUpload,
  uploadToSignedUrl,
  type ListedReceipt,
} from '../lib/receiptsApi';
import ReceiptsPage from './ReceiptsPage';

vi.mock('../lib/receiptsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/receiptsApi')>()),
  fetchReceipts: vi.fn(),
  startReceiptUpload: vi.fn(),
  uploadToSignedUrl: vi.fn(),
  confirmReceiptUpload: vi.fn(),
  removeReceipt: vi.fn(),
}));

const photo: ListedReceipt = {
  id: '11111111-1111-4111-8111-111111111111',
  fileName: 'cafe-lunch.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 2048,
  uploadStatus: 'ready',
  createdAt: '2026-10-30T10:00:00Z',
  aiStatus: 'extracted',
  readUrl: 'https://files.test/cafe-lunch.jpg',
};
const pdf: ListedReceipt = {
  ...photo,
  id: '22222222-2222-4222-8222-222222222222',
  fileName: 'train-ticket.pdf',
  mimeType: 'application/pdf',
  aiStatus: 'pending',
  readUrl: null,
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReceiptsPage />
    </QueryClientProvider>,
  );
}

function chooseFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('receipts list', () => {
  it('shows a loading message, then the empty message', async () => {
    vi.mocked(fetchReceipts).mockResolvedValue({ receipts: [], nextCursor: null });
    renderPage();
    expect(screen.getByRole('status').textContent).toMatch(/loading/i);
    expect(await screen.findByText('No receipts yet.')).toBeTruthy();
  });

  it('shows an error with a retry', async () => {
    vi.mocked(fetchReceipts).mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ receipts: [pdf], nextCursor: null });
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load receipts/i);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('train-ticket.pdf')).toBeTruthy();
  });

  it('lists name, date, statuses and a thumbnail or file icon', async () => {
    vi.mocked(fetchReceipts).mockResolvedValue({ receipts: [photo, pdf], nextCursor: null });
    renderPage();
    const photoRow = (await screen.findByText('cafe-lunch.jpg')).closest('li')!;
    expect(within(photoRow).getByText('30 Oct 2026')).toBeTruthy();
    expect(within(photoRow).getByText('Uploaded')).toBeTruthy();
    expect(within(photoRow).getByText('Read, awaiting your review')).toBeTruthy();
    expect(photoRow.querySelector('img')?.getAttribute('src')).toBe('https://files.test/cafe-lunch.jpg');
    const pdfRow = screen.getByText('train-ticket.pdf').closest('li')!;
    expect(within(pdfRow).getByText('Not read yet')).toBeTruthy();
    expect(pdfRow.querySelector('img')).toBeNull();
    expect(pdfRow.querySelector('svg')).toBeTruthy();
  });

  it('loads the next page with the cursor', async () => {
    vi.mocked(fetchReceipts)
      .mockResolvedValueOnce({ receipts: [photo], nextCursor: 'c1' })
      .mockResolvedValueOnce({ receipts: [pdf], nextCursor: null });
    renderPage();
    await screen.findByText('cafe-lunch.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('train-ticket.pdf')).toBeTruthy();
    expect(fetchReceipts).toHaveBeenLastCalledWith('c1');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});

describe('receipt upload', () => {
  it('uploads, shows progress, confirms and refreshes the list', async () => {
    vi.mocked(fetchReceipts).mockResolvedValue({ receipts: [], nextCursor: null });
    vi.mocked(startReceiptUpload).mockResolvedValue({ receipt: photo, uploadUrl: 'https://upload.test/u' });
    vi.mocked(uploadToSignedUrl).mockImplementation(async (_url, _file, onProgress) => onProgress(40));
    vi.mocked(confirmReceiptUpload).mockResolvedValue(photo);
    renderPage();
    await screen.findByText('No receipts yet.');
    chooseFile(new File(['x'], 'lunch.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(confirmReceiptUpload).toHaveBeenCalledWith(photo.id));
    expect(await screen.findByText('lunch.jpg: uploaded')).toBeTruthy();
    await waitFor(() => expect(fetchReceipts).toHaveBeenCalledTimes(2));
  });

  it('shows a progress bar while the file is sent', async () => {
    vi.mocked(fetchReceipts).mockResolvedValue({ receipts: [], nextCursor: null });
    vi.mocked(startReceiptUpload).mockResolvedValue({ receipt: photo, uploadUrl: 'https://upload.test/u' });
    vi.mocked(uploadToSignedUrl).mockImplementation((_url, _file, onProgress) => {
      onProgress(40);
      return new Promise(() => {});
    });
    renderPage();
    await screen.findByText('No receipts yet.');
    chooseFile(new File(['x'], 'lunch.jpg', { type: 'image/jpeg' }));
    const bar = await screen.findByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
  });

  it('refuses a wrong file type without sending anything', async () => {
    vi.mocked(fetchReceipts).mockResolvedValue({ receipts: [], nextCursor: null });
    renderPage();
    await screen.findByText('No receipts yet.');
    chooseFile(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/JPEG, PNG, WEBP or PDF/);
    expect(startReceiptUpload).not.toHaveBeenCalled();
  });

  it('refuses a file over 10 MB without sending anything', async () => {
    vi.mocked(fetchReceipts).mockResolvedValue({ receipts: [], nextCursor: null });
    renderPage();
    await screen.findByText('No receipts yet.');
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    chooseFile(big);
    expect((await screen.findByRole('alert')).textContent).toMatch(/10 MB or smaller/);
    expect(startReceiptUpload).not.toHaveBeenCalled();
  });

  it('shows the server refusal for a failed upload', async () => {
    vi.mocked(fetchReceipts).mockResolvedValue({ receipts: [], nextCursor: null });
    vi.mocked(startReceiptUpload).mockRejectedValue(new Error('Too many uploads'));
    renderPage();
    await screen.findByText('No receipts yet.');
    chooseFile(new File(['x'], 'lunch.jpg', { type: 'image/jpeg' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/lunch\.jpg.*Too many uploads/);
  });
});

describe('receipt removal', () => {
  it('names the file, and removes only after confirming', async () => {
    vi.mocked(fetchReceipts).mockResolvedValue({ receipts: [photo], nextCursor: null });
    vi.mocked(removeReceipt).mockResolvedValue(photo);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove cafe-lunch.jpg' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/cafe-lunch\.jpg/)).toBeTruthy();
    expect(removeReceipt).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove receipt' }));
    await waitFor(() => expect(removeReceipt).toHaveBeenCalledWith(photo.id));
    await waitFor(() => expect(fetchReceipts).toHaveBeenCalledTimes(2));
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    vi.mocked(fetchReceipts).mockResolvedValue({ receipts: [photo], nextCursor: null });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove cafe-lunch.jpg' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(removeReceipt).not.toHaveBeenCalled();
  });
});
