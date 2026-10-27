// Vercel's function bundler emits .ts modules under api/ but not .tsx/.jsx ones, so a
// ".js" import of a .tsx file typechecks yet crashes at runtime (STF-98). Fail on any
// JSX file reachable from an api route.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = join(root, 'api');
const JSX_FILE = /\.[tj]sx$/;

function routeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '_lib' || entry.name === '__tests__') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : [path];
  });
}

function resolveImport(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier.replace(/\.js$/, ''));
  return ['.ts', '.tsx', '.jsx', '.js', '/index.ts'].map((ext) => base + ext).find(existsSync);
}

const runtimeImport = /^\s*(?:import|export)\s(?!type\s)[^'"]*?from\s+'(\.[^']*)'|^\s*import\s+'(\.[^']*)'/gm;

const seen = new Set();
const jsxFiles = new Set();
const pending = routeFiles(apiRoot);
while (pending.length > 0) {
  const file = pending.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  if (JSX_FILE.test(file)) {
    jsxFiles.add(file);
    continue;
  }
  for (const match of readFileSync(file, 'utf8').matchAll(runtimeImport)) {
    const target = resolveImport(file, match[1] ?? match[2]);
    if (target) pending.push(target);
  }
}

if (jsxFiles.size > 0) {
  console.error(
    'JSX files reachable from api routes are not bundled by Vercel; write them as .ts (React.createElement):\n' +
      [...jsxFiles].map((file) => `  ${relative(root, file)}`).join('\n'),
  );
  process.exit(1);
}
