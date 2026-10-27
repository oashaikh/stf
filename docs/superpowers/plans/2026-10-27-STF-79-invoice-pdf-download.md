# STF-79: Invoice PDF download

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

- STF-78 is merged on this branch (HEAD 7ecf5c7): api/invoices.ts, api/_lib/invoices.ts and src/pages/InvoiceEditor.tsx exist; the read-only invoice view is ReadOnlyInvoice in InvoiceEditor.tsx, reached from InvoicesPage.tsx.
- The invoice store get(userId, id) already scopes by session owner and caps lines at 50, so the PDF loader reuses it.
- The business profile (name, address, bank details) and users.vat_number live on the users row; no schema change or migration is needed.
- @react-pdf/renderer is listed in package.json but is not imported anywhere yet; whether it bundles and runs inside a Vercel function is unproven, hence the measurement task.
- No installed PDF text extractor is present in node_modules; the test may need pdfjs-dist as a devDependency, to be justified in the PR.
- Download PDF is shown on the read-only invoice view only, not the draft editor.
- Verifying on a real Vercel deployment is outside the agent's remit (); only local measurements are possible.

## Out of scope

- Emailing the invoice to the client
- Custom branding, logos or templates
- Storing generated PDFs in object storage
- PDF download from the invoices list rows
- Any change to invoice maths, ledger postings or the schema
- Deploying or changing live Vercel configuration

## User journey

Starts at: Owner opens Invoices from the main navigation

1. Invoices list (`src/pages/InvoicesPage.tsx`)
   - Before: List of invoices; click opens one
   - After: Unchanged
2. Invoice view (sent, paid, overdue or voided) (`src/pages/InvoiceEditor.tsx (ReadOnlyInvoice)`)
   - Before: Buttons: Back to invoices, Mark paid, Void
   - After: Adds Download PDF, which downloads the invoice as a PDF from GET /api/invoice-pdf?id=...
   - Depends on: api/invoice-pdf.ts from tasks 1 to 3

Also depends on:
- STF-78 (merged)
- Business profile payment details and VAT number set in Settings (existing, STF-82 and business profile section)

## Tasks

- [ ] **Task 1: Invoice PDF data loader and pure VAT-by-rate summary**
  - Intent: Add a server loader that returns everything the PDF needs for one owner invoice, plus a pure helper that groups stored line figures into a VAT summary by rate. Loader: reuse the existing invoice get (already owner-scoped by session user id, lines capped at INVOICE_MAX_LINES) and add one bounded query (limit 1) on users for businessName, businessAddress, vatNumber and the payment bank name, sort code and account number. Never read a client-supplied owner id. Unknown or other owner's invoice returns undefined. The VAT summary helper lives next to the existing invoice maths in src/lib/invoiceMaths.ts (summing stored pence per rate, integers only) so the template does no arithmetic. Add a store interface so the route can be tested with a fake, matching InvoiceStore / BusinessProfileStore style. Reuse the existing profile columns rather than a new type if possible.
  - Files: `api/_lib/invoicePdfData.ts`, `api/_lib/__tests__/invoicePdfData.test.ts`, `src/lib/invoiceMaths.ts`, `src/lib/invoiceMaths.test.ts`
  - Acceptance criteria the planner set:
    - Loader selects only the columns the PDF needs (no select *) and every query has an owner filter on the session user id and a limit
    - VAT summary groups by vatRatePercent from stored line vatPence/subtotalPence, integer pence only, sorted by rate, and has a unit test with mixed 0/5/20 rates
    - Unit test: loader returns undefined for another owner's invoice id
    - npm run lint, typecheck and test pass
  - Risk: Default tier. Owner scoping is the key correctness point; reviewed via the 404 test in task 3.

- [ ] **Task 2: React PDF invoice template and render function** (after 1)
  - Intent: Create the server-side template with @react-pdf/renderer (already a dependency, v3.4.2, not yet used anywhere in src or api). It shows business name and address, VAT number only when present, client name/email/address, invoice number, issue and due dates (formatDate), a lines table (description, quantity, unit price, VAT rate, net), VAT summary by rate, total due and payment instructions (bank, sort code, account number) from the profile, and notes. All money goes through formatPence from src/lib/money.ts; no arithmetic in the template. Export renderInvoicePdf(data): Promise<Buffer> via renderToBuffer. Use built-in PDF fonts (Helvetica) so no font files need bundling; check that the pound sign renders. Write a test that renders a fixture with invented data and asserts the extracted text contains the invoice number, each total, the VAT number, and omits the VAT line when the owner is unregistered. react-pdf compresses and subsets text, so extract text via a PDF text reader. Prefer an already installed package; if none exists, add pdfjs-dist as a devDependency only and state in the PR why nothing installed can do it (). Check tsconfig.api.json (nodenext, jsx react-jsx) compiles a .tsx file under api/_lib and that eslint covers it.
  - Files: `api/_lib/invoicePdf.tsx`, `api/_lib/__tests__/invoicePdf.test.ts`, `package.json`, `package-lock.json`
  - Acceptance criteria the planner set:
    - renderInvoicePdf returns a buffer starting with %PDF
    - Test fails if invoice number, total due, VAT summary figure or VAT number is dropped from the template
    - Test with a non-VAT-registered owner shows no VAT number line
    - Template contains no multiplication/addition of money, only formatPence of stored values
    - If a devDependency is added, package-lock.json is updated and the reason is in the commit message
    - lint, typecheck, test, build pass
  - Risk: Default tier. Main uncertainty is PDF text extraction in vitest and react-pdf running under the api tsconfig.

- [ ] **Task 3: GET /api/invoice-pdf serverless route, vercel.json maxDuration and route tests** (after 1, 2)
  - Intent: Add api/invoice-pdf.ts following api/entries-export.ts (withAuth, default export { fetch }). GET only (405 otherwise), validates ?id as uuid (400, same UUID regex and refuse shape as api/invoices.ts), loads via task 1 using auth.userId only, returns 404 NOT_FOUND JSON for an unknown or another owner's invoice, otherwise application/pdf with Content-Disposition attachment filename built from the public number (sanitised) and Cache-Control no-store. Drafts: decide and document (assumption: allow any non-voided status, drafts included, since the owner may want a preview; voided returns 404 or 409 per implementer choice, stated in the PR). Add a functions entry in vercel.json with a maxDuration (30) and consider memory; measure first and report in the PR. Record the route in api/_lib/__tests__/apiRoutes.test.ts if that file lists every route (check for sign-in-required coverage). Route test with fake store: owner A gets a PDF whose text contains the number, totals and VAT number; owner B requesting A's id gets 404; unauthenticated gets 401; bad id gets 400. Document in docs/workflows/invoices.md.
  - Files: `api/invoice-pdf.ts`, `api/_lib/__tests__/invoicePdfRoute.test.ts`, `api/_lib/__tests__/apiRoutes.test.ts`, `vercel.json`, `docs/workflows/invoices.md`
  - Acceptance criteria the planner set:
    - Test: rendered PDF text contains invoice number, totals and VAT number
    - Test: second owner requesting the first owner's invoice id gets 404 and no PDF bytes
    - Test: no session gets 401; non-uuid id gets 400; non-GET gets 405
    - vercel.json has a maxDuration for api/invoice-pdf.ts and stays valid JSON
    - Response never includes the full account number in logs or error bodies
    - lint, typecheck, test, build pass
  - Risk: Opus/high: tenant isolation and authorisation on a route returning bank details; 404 for other owners is an explicit acceptance criterion.

- [ ] **Task 4: Measure PDF function bundle size and cold start** (after 3)
  - Intent: The operator asked that the PDF render inside a Vercel function with bundle size and cold start checked and reported. Without deploying anything or touching live config (), build the function the way Vercel would (esbuild or `vercel build` if available offline, else bundle api/invoice-pdf.ts with esbuild that is already installed via vite, externals as Vercel treats them) and record: bundled size, node_modules footprint of @react-pdf/renderer and its fontkit/yoga deps, and a local cold-start figure (fresh `node` process importing the handler and rendering one fixture invoice, time to first byte, run several times). Compare with the 250 MB unzipped function limit. Add a short section to docs/runbooks/vercel-deploy.md with the numbers, method, and the maxDuration/memory chosen, and tune the vercel.json entry if the numbers justify it. If yoga/WASM or font loading breaks in the bundle, report it as a finding. State clearly in the PR what was measured locally versus not measured on Vercel. No scripts or generated artefacts committed beyond the doc.
  - Files: `docs/runbooks/vercel-deploy.md`, `vercel.json`
  - Acceptance criteria the planner set:
    - Runbook section lists bundle size, dependency footprint, cold start timings (min/median of at least 5 runs) and the method
    - vercel.json maxDuration/memory justified by those numbers
    - Numbers reported honestly as local measurements, with the limit not tested on Vercel stated
    - No machine paths or secrets in the doc
    - lint, typecheck, test, build pass
  - Risk: Default tier. Measurement only; docs plus an optional one-line config tune.

- [ ] **Task 5: Download PDF button on the invoice view** (after 3)
  - Intent: Add downloadInvoicePdf(id) to src/lib/invoicesApi.ts (or src/lib/exportApi.ts pattern): fetch /api/invoice-pdf?id=... with credentials same-origin, throw with the server error message on non-OK, turn the blob into an object URL on a temporary anchor click (copy the approach in downloadEntriesCsv in src/lib/exportApi.ts, share any helper it already has rather than duplicating), then revoke the URL. In ReadOnlyInvoice in src/pages/InvoiceEditor.tsx (the invoice view shown for sent/paid/overdue/voided) add a 'Download PDF' button using buttonClass (min-h-11, 44px target, focus ring), showing a pending label while downloading and an inline role=alert error on failure. Decide whether DraftEditor also gets it (assumption: view only, as ticket says 'invoice view', and drafts can be previewed after issue). Add tests in src/pages/InvoicesPage.test.tsx with the api module mocked (): button appears on an issued invoice, click calls download with the invoice id, failure shows the error. Add GET /api/invoice-pdf to e2e/mockApi.ts returning a small PDF body so the journey and screenshots work.
  - Files: `src/lib/invoicesApi.ts`, `src/lib/exportApi.ts`, `src/pages/InvoiceEditor.tsx`, `src/pages/InvoicesPage.tsx`, `src/pages/InvoicesPage.test.tsx`, `e2e/mockApi.ts`
  - Acceptance criteria the planner set:
    - Download PDF button visible on the open invoice view, keyboard focusable, at least 44px tall, uses existing tokens/classes only
    - Clicking requests /api/invoice-pdf with the invoice id and triggers a file download; object URL is revoked
    - Server error shows a visible alert and does not navigate away
    - Component test with the API client mocked fails if the button or call is removed
    - lint, typecheck, test, build pass
  - Risk: Default tier.

- [ ] **Task 6: Review evidence: sample PDF and screenshots at 390 and 1440 px** (after 4, 5)
  - Intent: Produce the PR evidence. (a) Render one sample PDF from invented fixture data (a VAT-registered owner with mixed 20% and 0% lines) with the real template and save it under browser-evidence/STF-79/ as invoice-sample.pdf (invented data only/). (b) Using the Playwright mock journey (npm run test:journey:mock, no live services), capture the changed screen, the invoice view with the Download PDF button, at 1440 and 390 px; light only if there is no dark theme (check). Save as browser-evidence/STF-79/*.png following the existing STF-78 folder naming. Confirm no horizontal scroll at 1440 and that the button wraps cleanly at 390. List the files in the PR body so they can be attached. If a Playwright browser is unavailable in the sandbox, say so plainly rather than faking screenshots.
  - Files: `browser-evidence/STF-79/invoice-sample.pdf`, `browser-evidence/STF-79/invoice-view-1440.png`, `browser-evidence/STF-79/invoice-view-390.png`, `e2e/journey.spec.ts`
  - Acceptance criteria the planner set:
    - Sample PDF opens, shows invoice number, VAT summary, total due and payment instructions from invented data
    - Screenshots exist at 390 and 1440 px for the invoice view
    - No real customer data in any evidence file
    - lint, typecheck, test, build pass
  - Risk: Default tier.
