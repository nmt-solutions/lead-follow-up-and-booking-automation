## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An operator reconciles invoices and gross payments through fees, refunds, tax, FX, settlements and bank receipts.

## Acceptance criteria

- [ ] Import/record authoritative settlement and bank-receipt evidence through explicit adapters or authorized manual entry.
- [ ] Link transaction and settlement currencies/amounts, fee taxes, refunds and exchange-rate evidence without using the planning FX rate as an actual rate.
- [ ] Show expected versus observed totals, unresolved differences, attributable review/resolution and accounting exports.
- [ ] Keep collected tax separate from subscription revenue/margin and exclude separately customer-paid Meta charges from the operator's payment ledger.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 125, 139, 143, 144.
Source #1 acceptance scenarios: 35, 36, 38, 39.

<!-- ticket-plan: full-product-2026-11-05:T48 -->
