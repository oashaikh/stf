export async function downloadEntriesCsv(from: string, to: string): Promise<void> {
  const response = await fetch(`/api/entries-export?from=${from}&to=${to}`, { credentials: 'same-origin' });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.error === 'string' ? body.error : 'Could not export entries');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `entries-${from}-to-${to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
