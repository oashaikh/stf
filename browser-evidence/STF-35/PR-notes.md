# STF-35: Bank section on Settings

Full-page captures of Settings taken against the e2e mock API, light theme only (the app has no dark theme). All data is invented: "Example Business Current", account ending 1234. No sideways scroll at 1440 or 390 px (checked by comparing page scroll width with its client width). At 390 px the fixed bottom nav overlays the page in full-page captures; it does not cover the Bank section.

- `settings-bank-not-connected-1440-light.png`, `settings-bank-not-connected-390-light.png`: no bank linked, with the connect button.
- `settings-bank-connected-1440-light.png`, `settings-bank-connected-390-light.png`: linked account with masked number and consent expiry date, consent still valid.
- `settings-bank-expired-1440-light.png`, `settings-bank-expired-390-light.png`: consent past its expiry, with the expired message and a Reconnect button.
