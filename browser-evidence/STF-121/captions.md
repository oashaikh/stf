# STF-121 evidence: filing a VAT return as a guided flow

All figures are invented and come from the mocked sandbox API; test mode is shown on every step. Screens were walked from the VAT page as a signed-in owner with one open return, at 1440 and 390 px. The same titles are in `captions.json`.

## Screens

Files are named `vat-<return state>-<step>-<width>-light.png`.

| Return state | Step | What it shows |
| --- | --- | --- |
| confirmed | 1 of 2 | Each figure in plain words, box number in small text, Why is this amount? link |
| confirmed | 2 of 2 | One sentence of what is being sent, Send to HMRC (test mode) |
| draft | 1 of 2 | Same figures, return not yet confirmed |
| draft | 2 of 2 | Summary sentence, declaration to tick, Confirm return, Send disabled until confirmed |
| filed | 1 of 2 | Figures of a return already sent |
| filed | 2 of 2 | Summary and HMRC receipt, no send button |
| picker | 1 of 3 | Two returns due: pick one first |
| stop | none | Not connected, VAT number missing: the flow stops with the fix link beside it |
| stale | 2 of 2 | Payments changed since confirming: warning with a link to check them |
| none | none | "You have no VAT return to file right now" |

Every image exists at 1440 and 390 px.

## Where the screens differ from the spec, and why

1. Dark theme: not captured. The app ships light only (no dark styles in `src/styles/index.css`), so there is nothing to photograph.
2. Return-due step: with one open obligation it is skipped, as the spec says, so the walk is two steps. The picker and the stop screens are captured with extra mocked API answers.
3. Unsorted payments: no data source for it exists in the repo, so that stop is not built or shown. A stale return keeps the flow open so the user can still re-confirm after checking payments; the Send button stays disabled by the unchanged gate.
4. Back on step 1: the button is shown on every step as the ticket asks, though on the first step it has nowhere earlier to go within the flow.
5. The history and obligations lists no longer sit under a step; they show only when no step does (nothing due, or a stop screen). They are not yet on the Tax page; moving them was not in the plan.
6. Mock data oddity: the mocked return shows no transactions but a £45.00 refund figure. That is the mock's invented data, not app logic, and the summary sentence reads from it faithfully.
