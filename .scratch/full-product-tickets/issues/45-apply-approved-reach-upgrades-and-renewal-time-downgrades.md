## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business approves a prorated expansion and receives it after payment, while reductions take effect at renewal without deleting sales history.

## Acceptance criteria

- [ ] Preview a versioned prorated charge, tax and effective scope; require explicit approval and corresponding confirmed payment before immediate expansion.
- [ ] Handle failed/ambiguous upgrades idempotently and use supported card-specific change/payment/mandate paths rather than assuming universal native updates.
- [ ] Schedule reductions for renewal, then apply reduced future discovery/new-prospect entitlements while preserving historical records and incoming/engaged conversations.
- [ ] Revalidate saved searches and queued acquisition actions against effective reach; unresolved policy for already-running unengaged campaigns stays an explicit activation gate.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 7, 17, 25, 97, 99, 102, 103, 104, 105, 106, 107, 136, 137.
Source #1 acceptance scenarios: 7, 26, 27, 34.

<!-- ticket-plan: full-product-2026-11-05:T45 -->
