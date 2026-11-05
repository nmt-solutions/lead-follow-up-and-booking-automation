## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business downloads numbered seller invoices and applicable credit notes whose original amounts and tax evidence remain intact.

## Acceptance criteria

- [ ] Issue versioned seller documents with configured numbering, legal fields, currency precision/rounding and frozen customer/price/tax-rule/evidence snapshots.
- [ ] Generate private downloadable artifacts and show authorized invoice/credit-note history; a gateway receipt is not treated as our seller tax invoice.
- [ ] Make corrections via attributable linked credit notes/adjustments rather than rewriting issued documents or consuming another number on a retry.
- [ ] Change customer details, rates, registrations and prices and prove issued snapshots remain unchanged while later documents use the correct effective versions.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 134, 135, 138, 143.
Source #1 acceptance scenarios: 31, 32, 35, 38.

<!-- ticket-plan: full-product-2026-11-05:T46 -->
