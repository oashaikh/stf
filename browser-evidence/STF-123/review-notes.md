# STF-123 review notes: where the screens differ from the ease-of-use spec

1. **No dark captures.** The spec asks for light and dark. The app ships one light theme and has no dark styles, so there is nothing true to capture. Light only, at 1440 and 390.
2. **Setup to-dos have no dates and are not ordered by due date.** Spec section 1 wants to-dos soonest first with a date. Setup steps have no due date, so they are listed in step order in a "Finish setting up" block at the top of Home. STF-122 builds the full Home to-do list and can fold these in through the `setupTodos` function.
3. **Each to-do button says what it does** ("Answer", "Connect HMRC", "Connect bank"). The spec says one button opens the flow; its wording is not given. It opens `/setup?step=<step>` on that step.
4. **Home keeps its existing money cards below the to-dos.** The spec's money summary (money in, money out, tax to set aside) belongs to the Home rework in STF-122, so Home was not restyled here.
5. **Connect steps have no inline result.** HMRC and the bank take the user away and back, so the walkthrough shows the step before connecting and the next step after. The mock sends the user straight back to setup, connected.
6. **HMRC step says "Test mode".** Sandbox is the default, so the step says nothing is sent to HMRC for real. There is no live control in setup.
