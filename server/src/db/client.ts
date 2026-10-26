import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Options for a pooled serverless URL (Neon pooler). PgBouncer transaction mode cannot hold
// prepared statements, and each function instance should keep one short-lived connection.
export function buildClientOptions(databaseUrl: string | undefined): postgres.Options<Record<string, never>> {
  // An unset or unparsable URL (tests, builds) stays TLS-free; postgres() only fails on first query.
  const isLocal = !URL.canParse(databaseUrl ?? '') || LOCAL_HOSTS.has(new URL(databaseUrl as string).hostname);
  return {
    max: 1,
    idle_timeout: 20,
    prepare: false,
    ...(isLocal ? {} : { ssl: 'require' as const }),
  };
}

const databaseUrl = process.env.DATABASE_URL;

// postgres() connects lazily, so importing this module costs nothing until the first query.
export const db = drizzle(postgres(databaseUrl as string, buildClientOptions(databaseUrl)), { schema });
