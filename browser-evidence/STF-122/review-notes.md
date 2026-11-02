# Home: where the screens differ from docs/design/ease-of-use.md

1. **Dark theme not captured.** STF ships no dark theme, so there is nothing to show. Images are 1440 and 390 px, light only.
2. **Setup steps skipped are absent.** The spec lists them as to-dos. They arrive with STF-123; the builder already takes them and shows none until then.
3. **Money figures link to pages, not filtered payments.** Money in, Money out and Tax to set aside open Money in, Money out and Tax. The spec says each opens the payments behind it; a filtered view needs list filters that do not exist yet.
4. **New user sees "You're up to date."** Spec has no wording for a user with nothing connected. Setup steps will fill this gap once STF-123 lands.
5. **Only jobs due within 30 days are listed.** Later deadlines feed the "next date" line instead, so Home stays short. The spec does not set a window.
6. **Sort payments opens Bank.** There is no separate sorting flow yet.
7. **Dates read "due 5 November" and the overdue wording is "N days late".** This matches the spec examples; the year is left out.
