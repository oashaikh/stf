# Coding Standards — STF

## The three hardest rules

1. **Integer pence for all money.** `amount_pence: number` is always an integer representing GBP × 100. `formatPence()` from `src/lib/money.ts` is the only place amounts become display strings. Never use `toFixed(2)` on a raw amount anywhere outside `formatPence`.

2. **AI output is always a draft.** Any value produced by Claude Haiku (receipt amounts, dates, categories) must be stored with a `status` of `'draft'` or `'pending'`. It becomes authoritative only after the user explicitly confirms it. No exceptions.

3. **HMRC calls through the client only.** `src/lib/hmrc/client.ts` is the single entry point for all HMRC API interactions. No route, job, or component may call the HMRC API directly.

## TypeScript

- Strict mode on. No `any`. No `@ts-ignore` without an explanatory comment.
- Prefer `type` over `interface` for data shapes.
- Enums → `const` unions: `type Status = 'draft' | 'confirmed'`, not `enum Status`.
- No `null` in financial amounts — use `0` or `undefined` depending on context.

## React

- Functional components only.
- State that affects multiple components goes in Zustand. Local UI state stays in `useState`.
- No financial logic in components. Components call domain functions from `src/lib/`.
- Every form must show the calculated total before submit.
- Every async action must handle loading, success, and error states.

## File naming

- `kebab-case` for all files and directories.
- Feature code lives in `src/features/<feature-name>/`.
- Shared components in `src/components/`.
- Domain logic (pure functions) in `src/lib/`.

## Testing

- All functions in `src/lib/money.ts`, `src/lib/vat.ts`, `src/lib/taxBands.ts` must have unit tests.
- Vitest for unit tests; Playwright for E2E.
- Test files live next to the file they test: `money.ts` → `money.test.ts`.
- Every HMRC API integration function must have a sandbox integration test.

## Git

```bash
npm run push -- -a -m "your message"   # runs typecheck + test + build before committing
npm run push -- --dry-run -a           # checks only, no commit
```

Never push directly to `main`. PRs required for all changes.

## Comments

Write comments that explain *why*, not *what*. The code shows what; the comment explains the non-obvious reason.

```typescript
// Good: explains the why
// HMRC expects VAT amounts rounded to the nearest penny using half-up rounding.
// Math.round implements half-up for positive numbers.
const vatPence = Math.round(netPence * 0.2);

// Bad: restates the code
const vatPence = Math.round(netPence * 0.2); // multiply by 0.2 and round
```
