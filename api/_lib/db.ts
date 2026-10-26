import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../../server/src/db/schema.js';

// postgres() connects lazily, so importing this module costs nothing until the first query.
export const db = drizzle(postgres(process.env.DATABASE_URL as string), { schema });
