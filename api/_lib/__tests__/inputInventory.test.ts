import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
const inventory = readFileSync(join(root, 'docs', 'security', 'input-inventory.md'), 'utf8');

/** Route files are the .ts files directly under api/ or one folder down, excluding _lib and tests. */
function routeFiles(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, 'api'), { withFileTypes: true })) {
    if (entry.name === '_lib' || entry.name === '__tests__') continue;
    if (entry.isFile() && entry.name.endsWith('.ts')) found.push(`api/${entry.name}`);
    if (entry.isDirectory()) {
      for (const child of readdirSync(join(root, 'api', entry.name), { withFileTypes: true })) {
        if (child.isFile() && child.name.endsWith('.ts') && !child.name.endsWith('.test.ts')) found.push(`api/${entry.name}/${child.name}`);
      }
    }
  }
  return found;
}

describe('input inventory', () => {
  it('finds the route files it checks', () => {
    expect(routeFiles().length).toBeGreaterThan(20);
  });

  it('lists every api route file', () => {
    const missing = routeFiles().filter((file) => !inventory.includes(`\`${file}\``));
    expect(missing, `add these to docs/security/input-inventory.md: ${missing.join(', ')}`).toEqual([]);
  });
});
