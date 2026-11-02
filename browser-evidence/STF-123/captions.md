# STF-123 evidence: first-time setup as a guided flow

All figures and numbers are invented and come from the mocked sandbox API; no real account or data is shown. Each screen was walked from sign-in as a brand-new user, at 1440 and 390 px. The app has no dark theme, so every image is light (see review-notes.md). The same titles are in `captions.json`.

Files are named `<walk>-<screen>-<width>-light.png`. The `finished` walk answers every step; the `skipped` walk skips every step.

| Image (1440 and 390) | Title |
| --- | --- |
| `finished-1-business-type` | The first setup question asks what kind of business you run, with the official name in small text |
| `finished-2-vat` | The second setup question asks whether you are registered for VAT and, if so, for your VAT number |
| `finished-3-hmrc` | The third setup step offers to connect to HMRC and says plainly that this is test mode |
| `finished-4-bank` | The last setup step offers to connect your bank so payments come in without typing |
| `finished-5-all-set` | Setup ends with a short "You are all set" screen and one button to Home |
| `finished-6-home` | Home after finishing setup has no setup to-dos left |
| `skipped-1-all-set` | Setup ends the same way when every step was skipped, and says skipped steps wait on Home |
| `skipped-2-home-with-to-dos` | Home after skipping setup lists each skipped step as a to-do with a button to do it now |
