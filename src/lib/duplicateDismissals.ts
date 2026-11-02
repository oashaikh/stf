const STORAGE_KEY = 'stf-duplicate-dismissed';

// ponytail: localStorage, so a dismissal does not follow the owner to another device or browser.
// Upgrade path: a server table keyed by owner and warning key.
function readDismissed(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

export function isDuplicateDismissed(key: string): boolean {
  return readDismissed().includes(key);
}

export function dismissDuplicate(key: string): void {
  if (isDuplicateDismissed(key)) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...readDismissed(), key]));
}
