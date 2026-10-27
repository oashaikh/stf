import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('no .tsx or .jsx file is reachable from an api route (Vercel does not bundle them)', () => {
  const script = join(__dirname, '..', '..', '..', 'scripts', 'checkApiJsx.mjs');
  expect(() => execFileSync('node', [script], { stdio: 'pipe' })).not.toThrow();
});
