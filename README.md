# STF — Sole Trader Finance

**Open-source accounting for sole traders and small startups. No subscription. Bring your own keys.**

STF replaces Xero / QuickBooks for sole traders. Record expenses, issue invoices, calculate VAT, and file directly with HMRC via Making Tax Digital — all from a web app you control. Receipt scanning is powered by Claude Haiku (your own Anthropic API key).

---

## Quick start (local)

```bash
git clone https://github.com/oashaikh/stf
cd stf
cp .env.example .env.local
# Fill in your keys (see .env.example for instructions)

docker compose up -d          # starts Postgres + MinIO; creates the stf-receipts bucket
npm install
# drizzle-kit does not read .env.local, so pass the URL explicitly
DATABASE_URL=postgres://postgres:postgres@localhost:5432/stf npm run db:migrate
npm run dev                   # opens http://localhost:5173
```

Data lives in the `postgres_data` and `minio_data` Docker volumes and survives
`docker compose down` and restarts. `docker compose down -v` wipes both. The MinIO
console is at http://localhost:9001 (minioadmin / minioadmin, local only).

In a second terminal (local control plane, only needed to run the scheduled jobs such as HMRC token refresh locally; on Vercel they run through Vercel Cron):

```bash
npm run dev:server
```

---

## What it does

- **Expense recording** — manual entry or upload a photo/PDF of a receipt; Claude Haiku reads it for you
- **Invoice creation** — issue professional invoices with PDF export; mark as paid and post to the ledger
- **VAT returns** — builds the nine MTD boxes from your transactions; submit to HMRC in one click
- **Income tax estimate** — running P&L with an estimated self-assessment figure
- **Bank feed** — import transactions from your bank (Phase 3; requires Open Banking provider key)
- **HMRC direct integration** — VAT today; Income Tax self-employment updates (Phase 3)

---

## Journey test against a deployed URL

One Playwright spec signs in as the owner and walks Dashboard, Expenses, VAT (review of the first open obligation, then "Preview what will be sent") and Settings at 390 px. It fails on any console error and names the step, the URL and the screenshot. It never presses Submit or Confirm: any request other than GET, the login, and the preview is blocked and fails the run.

```bash
# Against a deployed app (read-only apart from the login)
JOURNEY_BASE_URL=https://your-app.example JOURNEY_OWNER_PASSWORD=... npm run test:journey

# Locally, against the built preview with a mocked API
npm run build && npm run test:journey:mock
```

Screenshots go to `e2e/artifacts/<run>/`, one per step. `<run>` is a timestamp unless you set `JOURNEY_RUN_NAME`. Set `JOURNEY_CHROMIUM_PATH` to use an existing Chrome instead of Playwright's own (`npx playwright install chromium`).

The first open VAT return must already be confirmed, because the preview button only appears then and the test will not confirm it. Opening an unconfirmed return makes the app save a draft; the test blocks that write and fails at the preview step.

---

## Required API keys

You supply all keys. STF does not phone home.

| Key | Where to get it | Required for |
|---|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Receipt scanning |
| `OWNER_PASSWORD` | Choose one; change it to reset | Owner login (server) |
| `SESSION_SECRET` | `openssl rand -base64 32` | Signs the session cookie (server) |
| `DATABASE_URL` | Your Postgres instance | Everything |
| `STORAGE_*` | Any S3-compatible provider | Receipt storage |
| `HMRC_CLIENT_ID` + `HMRC_CLIENT_SECRET` | [developer.service.hmrc.gov.uk](https://developer.service.hmrc.gov.uk) | HMRC submission |

See `.env.example` for the full list with instructions.

---

## HMRC sandbox

HMRC sandbox mode is **on by default**. No live submissions happen until you explicitly set `HMRC_SANDBOX_MODE=false` in your env AND enable production mode in your account Settings. Test freely.

---

## Hosting

STF runs on Vercel serverless routes in the `api/` folder (London region), with Neon Postgres in London. Login is a single owner password and a signed session cookie; there is no sign-up. Scheduled jobs run through Vercel Cron.

---

## Architecture

See `AI.md`, `architectures.md`, and `PLAN.md` for the full technical design, data model, and project roadmap. These files are written for AI coding agents and human contributors alike.

---

## Development

```bash
npm test              # unit tests (Vitest)
npm run build         # typecheck + production bundle
npm run preview       # serve production build
npm run push -- -a -m "message"   # guarded commit + push
```

For Vercel deployment, see `docs/runbooks/vercel-deploy.md`.

---

## Contributing

STF is open source and welcomes contributions. Read `AI.md` before submitting a PR — especially the money rule (integer pence always), the AI rule (extractions are always drafts), and the HMRC rule (sandbox by default).

---

## Roadmap

See `PLAN.md` for the full phase-by-phase roadmap.

- **Phase 1** — Expenses, receipts, invoices, P&L (current)
- **Phase 2** — VAT returns + HMRC MTD submission
- **Phase 3** — Income Tax self-assessment via MTD
- **Phase 4** — Bank feed import and reconciliation
- **Phase 5** — Advanced automation (email receipt ingestion, anomaly detection)
