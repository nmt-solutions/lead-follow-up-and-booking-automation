## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business completes hosted checkout and receives paid access only after authoritative, reconciled payment confirmation.

## Acceptance criteria

- [ ] Create a server-derived reviewed quote/checkout action with explicit plan, currency, tax, provider references and intended entitlements.
- [ ] Persist authenticated payment events durably, deduplicate at event and business-operation boundaries and handle out-of-order/replayed updates.
- [ ] A browser redirect or pending/ambiguous payment cannot grant access; confirmed payment establishes the correct period, paid-through state and scope exactly once.
- [ ] Show checkout, pending/review, confirmed and failed states in the customer/operator views using deterministic gateway adapters and real internal billing logic.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 99, 101, 106, 131, 136, 137, 143.
Source #1 acceptance scenarios: 26, 30, 31, 33, 38.

<!-- ticket-plan: full-product-2026-11-05:T42 -->
