## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An authorized Business user saves legal billing details and supporting evidence used for its subscription invoices.

## Acceptance criteria

- [ ] Capture legal identity, billing address/country, invoice contact and applicable tax identifiers/business-status evidence with authorized review history.
- [ ] Separate billing-country classification from discovery geography and planning FX assumptions; support INR India/USD international configuration without inventing prices.
- [ ] Keep missing/conflicting evidence explicit and route it for review rather than inferring exemption or export treatment.
- [ ] Restrict Business users to their own financial records and private evidence; only separately authorized operators can perform global tax administration.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 131, 133, 135, 143.
Source #1 acceptance scenarios: 31, 32, 38.

<!-- ticket-plan: full-product-2026-11-05:T39 -->
