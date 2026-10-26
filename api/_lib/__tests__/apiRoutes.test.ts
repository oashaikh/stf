import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiRoot = join(__dirname, '..', '..');

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '_lib' || entry.name === '__tests__') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : [path];
  });
}

const routes = routeFiles(apiRoot);

describe('api routes', () => {
  it('finds the route files', () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  it.each(routes)('%s default-exports a fetch handler', async (route) => {
    const module = await import(route);
    expect(typeof module.default?.fetch).toBe('function');
  });

  it.each(routes)('%s uses explicit .js extensions on relative imports (Node ESM)', (route) => {
    const relativeSpecifiers = [...readFileSync(route, 'utf8').matchAll(/from '(\.[^']*)'/g)].map((m) => m[1]);
    for (const specifier of relativeSpecifiers) expect(specifier).toMatch(/\.js$/);
  });

  it.each(routes)('%s pulls no browser-only code from src/', (route) => {
    expect(readFileSync(route, 'utf8')).not.toMatch(/import\.meta\.env|from 'react/);
  });
});
