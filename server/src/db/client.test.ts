import { describe, expect, it, vi } from 'vitest';

import { buildClientOptions } from './client';

describe('buildClientOptions', () => {
  it('requires TLS, one connection, short idle and no prepared statements for a hosted URL', () => {
    const options = buildClientOptions('postgres://user@ep-pooler.example.neon.tech/stf?sslmode=require');
    expect(options).toMatchObject({ ssl: 'require', max: 1, idle_timeout: 20, prepare: false });
  });

  it.each(['localhost', '127.0.0.1'])('leaves %s without TLS', (host) => {
    const options = buildClientOptions(`postgres://postgres:postgres@${host}:5432/stf`);
    expect(options.ssl).toBeUndefined();
    expect(options).toMatchObject({ max: 1, idle_timeout: 20, prepare: false });
  });

  it.each([undefined, 'not a url'])('throws for %s on Vercel instead of dialling localhost', (url) => {
    vi.stubEnv('VERCEL', '1');
    expect(() => buildClientOptions(url)).toThrow('DATABASE_URL');
    vi.unstubAllEnvs();
  });
});
