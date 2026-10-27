export async function downloadFile(url: string, filename: string, fallbackError: string): Promise<void> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.error === 'string' ? body.error : fallbackError);
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

export function downloadEntriesCsv(from: string, to: string): Promise<void> {
  return downloadFile(`/api/entries-export?from=${from}&to=${to}`, `entries-${from}-to-${to}.csv`, 'Could not export entries');
}
