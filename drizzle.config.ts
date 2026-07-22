import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/src/db/schema.ts',
  out: './server/src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL as string,
  },
});
