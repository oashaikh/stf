# Ease of use

Agreed with the owner on 1 November 2026. Every STF screen follows this page, new and existing. Being very easy to use is what sets STF apart from Xero and Sage, so where this page and a ticket disagree, this page wins. If something isn't covered here, ask in the ticket's conversation. Don't guess.

## Who STF is for

A sole trader or a small company director with **no accounting knowledge**. They don't know what a ledger, a posting, a nominal code or a VAT box is, and they shouldn't need to. They want to know three things: what they need to do, by when, and whether they've done it.

## 1. Home is a to-do list

Home answers "what needs doing?" and nothing else comes first.

- A list of things to do, soonest first, each one in plain words with its date. For example "File your VAT return, due 7 December", "Sort 9 bank payments", "Send your Income Tax update, due 5 February", "Your bank connection runs out in 6 days".
- Each item has one button that opens the guided flow for it.
- Overdue items are at the top and say how late they are.
- When nothing is due, say so plainly ("You're up to date. Your next VAT return is due 7 March.").
- Below the list there's a short money summary: money in and money out this month, and tax to set aside. Each figure opens the payments behind it.

## 2. Guided flows for every job

Anything that ends in sending something to HMRC or Companies House, or that a new user must do once, is a guided flow, not a page full of controls.

- **One question or one thing to check per screen.** A progress line shows where they are ("Step 2 of 4").
- **Back and "Save and leave"** on every step. Coming back resumes where they stopped.
- **Every figure explains itself.** Each amount has "Why is this £120?", which shows the payments behind it in plain words and lets them fix one.
- **Problems stop the flow early, in plain words, with the fix next to them.** For example, "3 payments from August aren't sorted yet. Sort them now" opens the sorting flow and then returns.
- **Never ask for something STF can work out.** Pre-fill from what's already known (business details, HMRC connection, past choices) and ask only to confirm.

The flows:

| Flow | Ends with |
|---|---|
| First-time setup | Business type, VAT registered or not, HMRC connected, bank connected (each step can be skipped and comes back as a to-do) |
| File a VAT return | Submitted to HMRC, with a receipt saved |
| Send an Income Tax update (quarterly) | Submitted to HMRC, with a receipt saved |
| Income Tax year end (allowances, adjustments, final declaration) | Submitted to HMRC |
| Sort bank payments | Each payment shown one at a time: "What was this?", with a suggested answer, a one-tap confirm, and "same for all from this payee" |
| Add a receipt | Photo or file in, details read automatically, the person checks and confirms (still a draft until confirmed) |
| Send an invoice | Customer, what for, amount, send. Marking it paid happens automatically when the payment arrives in the bank, or with one tap |

Company filings (CT600, accounts, confirmation statement, PAYE) will follow the same pattern when they're built.

## 3. Before anything is sent

The last step of every filing flow shows one plain sentence about what is being sent, the figures that matter, and the declaration. For example: **"You're telling HMRC you owe £0 VAT for August to October 2026."** The button says what it does ("Send to HMRC"), not "Submit". Test (sandbox) mode is labelled on the screen, every time.

## 4. Plain words

Interface text is plain English, short sentences, and "you" and "your". Say what happens, not how the system works.

| Never on screen | Say instead |
|---|---|
| ledger, posting, journal, nominal code, chart of accounts | payments, money in, money out, category |
| reconcile, reconciliation | match, sort |
| obligation, period key | return due, quarter |
| Box 1 / VAT due on sales | VAT you charged customers |
| Box 4 / VAT reclaimed on purchases | VAT you paid on business costs |
| Box 6 / total value of sales ex VAT | your sales before VAT |
| submit, payload, endpoint, sync, token | send, connect, update |
| error codes or raw HMRC messages | what went wrong and what to do now |

**Official names in small text.** Where an HMRC or Companies House name helps someone check against a letter or talk to an accountant, show it in small muted text under the plain words ("VAT you charged customers" with "Box 1" beneath). That's the only place official terms appear.

Errors say what happened, whether money or a filing is affected, and the next step. Never blame the person.

## 5. Menu

Six items, grouped by money:

| Item | Holds |
|---|---|
| Home | To-do list, money summary |
| Money in | Invoices, other income |
| Money out | Expenses, receipts, mileage |
| Bank | Connected accounts, sorting payments |
| Tax | VAT, Income Tax, and company filings later; past returns and reports |
| Settings | Business details, HMRC connection, security, preferences |

Reports live inside Home and Tax, not as a menu item.

## 6. Day-to-day pages

Pages for browsing (Money in, Money out, Bank, Tax history) stay simple:

- One main action per page, clearly placed (for example "Add a receipt").
- Lists show what a person recognises (date, who, what for, amount), with the category in plain words.
- Filters are a search box and a few plain choices ("This month", "Not sorted"), not a form.
- Empty pages explain what goes there and offer the first action.
- Phone first: every flow and page works at 390 px, and adding a receipt from a phone camera is the quickest path in the app.

## 7. Checks

- **Jargon test.** A test renders every page and flow and fails the build if a word from the "Never on screen" column appears. The only exception is text marked as an official name (the small-text pattern above).
- **First-time user check.** Every UI ticket's evidence includes walking its flow from the start as a new user, with screenshots at 1440 and 390, light and dark, and a captions file giving each image a plain-English title.
- Each UI ticket says in its review where its screens differ from this page and why.
