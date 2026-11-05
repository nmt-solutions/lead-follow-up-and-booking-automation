## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An authorized operator exports a reviewed period and records supported filing/payment confirmations with retained evidence.

## Acceptance criteria

- [ ] Generate accounting/filing exports and support authorized manual or explicitly supported external submission/remittance adapters.
- [ ] Record submission/payment references, supporting files, approvals and acknowledgements as distinct steps with attributable status history.
- [ ] An export, attempted submission or payment initiation alone never marks an obligation filed/paid; reconcile confirmations and liabilities idempotently.
- [ ] Keep unknown jurisdiction/adapter configuration unavailable and exercise failed/ambiguous/replayed confirmation fixtures with operator-only access.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 140, 141, 142, 143, 144.
Source #1 acceptance scenarios: 36, 37, 38.

<!-- ticket-plan: full-product-2026-11-05:T50 -->
