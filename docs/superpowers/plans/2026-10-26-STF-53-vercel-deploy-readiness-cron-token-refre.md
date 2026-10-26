# STF-53: Vercel deploy readiness: cron token refresh, serverless Postgres, deploy runbook

> Machine-generated plan (model `claude-sonnet-5-5`, effort `medium`) for
> the ticket. Progress below is written by the orchestrator; the
> database copy is authoritative — editing this file does not change execution.
> A task's [x] is the orchestrator's record that the task finished; the
> criteria beneath it are what the planner asked for, not individually
> verified — no per-criterion outcome is recorded anywhere.
> Prose written under a task entry is kept across progress ticks and is
> the place to record analysis. So are edits to the entry's Intent, Files,
> criteria and Risk bullets once the file exists; only its heading's mark and
> the Commit bullet are re-rendered from the database.

## Assumptions

- Vercel sends `Authorization: Bearer [REDACTED] to cron paths when CRON_SECRET is set in project env, so that is the header the function checks.
- The refresh job, refreshDueTokens, is reused unchanged; only its trigger moves to a serverless route.
- The 5-minute cron needs a Vercel Pro plan; Hobby allows once-daily crons. The runbook tells the owner.
- `vercel build` may need the CLI, login or network this sandbox lacks, so it may be only partly verifiable here; the implementer must report honestly.
- Migrations use drizzle-kit via the existing db:migrate script against the direct (unpooled) Neon URL; no new migration file is needed.

## Out of scope

- Actually deploying to Vercel or setting live env vars (: owner/operator only).
- Moving receipt object storage or Clerk configuration.
- Changes to HMRC token refresh logic, batch size or schedule semantics.
- VAT history work in STF-20 (shared files such as api/_lib/vatReturns.ts are touched only if import fixes demand it).

## Tasks

- [x] **Task 1: Serverless-safe Postgres client shared by api/ and the refresh job**
  - Intent: One lazily-connected postgres-js client for a pooled (Neon pooler) URL: TLS required outside local dev, max 1 connection, short idle timeout, and prepared statements off because PgBouncer transaction mode cannot hold them. Today api/_lib/db.ts and server/src/db/client.ts each build their own client with default options, so fix the options once in server/src/db/client.ts and make api/_lib/db.ts re-export it (check no test mocks the old path first). Document DATABASE_URL in .env.example for the pooled Neon URL, with no values, and note the direct (unpooled) URL is the one used for migrations. Add a small unit test that the option builder returns ssl/max/idle_timeout/prepare:false for a hosted URL and leaves a localhost URL without TLS.
  - Files: `server/src/db/client.ts`, `server/src/db/client.test.ts`, `api/_lib/db.ts`, `.env.example`
  - Acceptance criteria the planner set:
    - Importing the client does not open a connection (lazy).
    - A test fails if ssl, max=1, idle_timeout or prepare:false is dropped for a non-localhost URL.
    - api/_lib/db.ts has no second postgres() call; existing api tests still pass.
    - .env.example comments describe a pooled Neon URL with sslmode=require and contain no real values; the envExample test still passes.
    - npm run lint, typecheck and test pass.
  - Risk: Opus/high: the database connection and TLS settings affect every route and the data path.
  - Commit: `23f4440ae713`

- [ ] **Task 2: Vercel Cron function for HMRC token refresh, secured by CRON_SECRET** (after 1)
  - Intent: Add api/cron/refresh-hmrc-tokens.ts, a fetch-style default export matching the other api routes. It must reject any request whose Authorization header is not exactly `Bearer ${CRON_SECRET}`, using a constant-time compare, and fail closed when CRON_SECRET is unset. With the right header it runs the existing refresh job and returns a small JSON ok body. No secret or error text in logs or the response. Keep server/src/index.ts and the Fastify scheduler as the local-only path, with a comment saying so. Add a vercel.json crons entry for the route on `*/5 * * * *`, matching TICK_INTERVAL_MS. Add CRON_SECRET to .env.example (no value). Export a handler factory with injectable job and secret, as the other routes do, so the test needs no database. Tests: no header refused and refresh not called; wrong secret refused; unset env secret refused; correct secret runs refresh once.
  - Files: `api/cron/refresh-hmrc-tokens.ts`, `api/cron/__tests__/refreshHmrcTokens.test.ts`, `vercel.json`, `.env.example`, `server/src/index.ts`
  - Acceptance criteria the planner set:
    - A test shows a request without the cron secret is refused and the refresh is not run.
    - A test shows a request with the correct secret runs the refresh exactly once.
    - With CRON_SECRET unset the route refuses every request.
    - vercel.json has a crons entry whose path matches the route file.
    - CRON_SECRET appears in .env.example and the envExample test passes.
    - Fastify entrypoint still starts the interval scheduler for local use, commented as local only.
    - npm run lint, typecheck, test and build pass.
  - Risk: Opus/high: an authentication boundary on a public URL that touches stored HMRC tokens.

- [ ] **Task 3: Make every api/ route bundle on Vercel, including server/ and src/ imports** (after 2)
  - Intent: package.json has type: module, and api/ and server/ files import relative modules without extensions while some use '.js'. Vercel's Node runtime may fail on extensionless ESM imports or not trace files outside api/. Inspect how the builder handles this, then fix once and consistently: functions config in vercel.json (e.g. includeFiles for server/src and src/lib) and/or normalise import specifiers. Prefer the smallest change that makes `vercel build` succeed. Add the vercel CLI as a devDependency only if it cannot be run otherwise, and say why. Confirm no api route imports React, import.meta.env or browser-only code from src/. If vercel build needs network or login unavailable here, report exactly what was and was not verified. Add a guard test that every route file under api/ (excluding _lib and __tests__) has a default export with a fetch handler.
  - Files: `vercel.json`, `package.json`, `package-lock.json`, `api/_lib/db.ts`, `api/_lib/hmrcStore.ts`, `api/_lib/vatSubmit.ts`, `api/_lib/vatReturns.ts`, `api/hmrc/callback.ts`, `api/hmrc/connect.ts`, `api/me.ts`, `api/_lib/__tests__/apiRoutes.test.ts`
  - Acceptance criteria the planner set:
    - `npx vercel build` (or the closest runnable local check) completes, or the report states precisely what blocked it.
    - Every api route's relative imports resolve under Node ESM, or vercel.json carries the includeFiles needed.
    - A test enumerates api routes and fails if one lacks a default fetch handler.
    - No unrelated refactor; any lockfile change is justified in the commit message.
    - npm run lint, typecheck, test and build pass.
  - Risk: Sonnet/medium. Edits are mechanical but bundler behaviour must be verified, not assumed. api/_lib files are possible edits only.

- [ ] **Task 4: Deploy runbook: Vercel env vars, HMRC redirect URI, Clerk origins, manual migrations** (after 3)
  - Intent: Add docs/runbooks/vercel-deploy.md as a short page. List the env vars to set in Vercel (names only, no values): DATABASE_URL (pooled Neon URL), CLERK_SECRET_KEY, VITE_CLERK_PUBLISHABLE_KEY, CLERK_AUTHORIZED_PARTIES, HMRC_* with HMRC_SANDBOX_MODE=true by default, APP_ORIGIN, STORAGE_*, ANTHROPIC_API_KEY, CRON_SECRET. Give the HMRC redirect URI to register (https://<domain>/api/hmrc/callback, same as HMRC_REDIRECT_URI) and the Clerk allowed origins (deployed origin, matching CLERK_AUTHORIZED_PARTIES and APP_ORIGIN). State that migrations never run on deploy and give the one-line manual command, e.g. DATABASE_URL=<direct-unpooled-url> npm run db:migrate. Cover cron authentication, that Fastify is local-only, and the Pro-plan note for the 5-minute cron. Mark the CONTROL_PLANE heading in .env.example as local only. Check every var name against .env.example and the code. Link from README if it lists docs.
  - Files: `docs/runbooks/vercel-deploy.md`, `.env.example`, `README.md`
  - Acceptance criteria the planner set:
    - Page lists env var names with no values, the HMRC redirect URI and the Clerk allowed origins.
    - One copy-pasteable migration command, and a statement that migrations do not run on deploy.
    - Every env var named in the page exists in .env.example.
    - No machine paths, tokens or real hostnames appear.
    - npm run lint, typecheck, test and build pass.
