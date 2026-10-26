# CLAUDE.md — STF (Sole Trader Finance)

This file is read automatically by Claude Code (the CLI) when you open this project.

## First: read the architecture docs

Before making any change, read in order:
1. `AI.md` — operating rules and hard stops
2. `architectures.md` — data model, currency rules, layer boundaries
3. `PLAN.md` — roadmap and feature deep-dives

## Non-negotiable rules

**Money:** All amounts are integer pence (GBP × 100). No floating-point. Ever.

**AI output:** Receipt extractions are always drafts. User must confirm before any record is persisted.

**HMRC:** Sandbox mode by default. No live submission without `HMRC_SANDBOX_MODE=false` AND user opt-in in Settings.

**Deletes:** Soft-delete only for financial records. Set `deleted_at`; never `DELETE FROM`.

## Common commands

```bash
npm run dev              # frontend dev server (http://localhost:5173)
npm run dev:server       # local control plane (Fastify), local scheduled jobs only
npm test                 # Vitest unit tests
npm run build            # typecheck + bundle
npm run push -- -a -m "message"  # safe commit + push
docker compose up -d     # local Postgres + MinIO
```

## Project layout (quick reference)

```
src/lib/money.ts         — formatPence, parsePence (all currency display goes here)
src/lib/vat.ts           — pure VAT calculation functions
src/lib/taxBands.ts      — income tax and NIC bands by tax year
src/lib/receiptPrompt.ts — Haiku prompt builder
src/lib/hmrc/client.ts   — HMRC API client (all HMRC calls go through here)
api/_lib/auth.ts         — signed-cookie owner session check for API routes
api/_lib/db.ts           — DB connection
docs/workflows/          — workflow write-ups (vat-return.md)
docs/runbooks/           — operational runbooks (Vercel deploy, HMRC sandbox)
```

`docs/agents/` (AI agent SOPs) and `docs/adr/` (decision records) do not exist yet. Create them when the first SOP or ADR is written.

## Remote access (Claude Code tunnels)

To access this project remotely from VS Code or the Claude mobile app:

```bash
# From this machine:
claude tunnel --project stf
# Follow the printed URL to connect from anywhere.
```

Or use VS Code Remote Tunnels:
```bash
code tunnel --name stf
```

The `.vscode/` directory contains recommended extensions including the Claude Code extension.
