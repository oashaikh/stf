import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Set by the platform or the runtime, never by a developer.
const PLATFORM_PROVIDED = new Set(['NODE_ENV', 'VERCEL_GIT_COMMIT_SHA']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === '__tests__') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('.env.example', () => {
  it('documents every environment variable the code reads', () => {
    const used = new Set<string>();
    for (const root of ['src', 'api', 'server']) {
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]+)/g)) {
          used.add(match[1]);
        }
      }
    }
    const template = readFileSync('.env.example', 'utf8');
    const documented = new Set(
      [...template.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]),
    );
    const missing = [...used].filter((name) => !documented.has(name) && !PLATFORM_PROVIDED.has(name));
    expect(missing).toEqual([]);
  });
});
