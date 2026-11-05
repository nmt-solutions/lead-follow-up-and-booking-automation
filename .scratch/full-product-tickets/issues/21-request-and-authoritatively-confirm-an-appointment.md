## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business offers available slots and confirms a booking only after the authoritative calendar event is created and retained.

## Acceptance criteria

- [ ] Configure working hours, Business/customer time zones, duration and buffers; show candidate slots with persisted holds/locks where required.
- [ ] Recheck availability immediately before an idempotent booking operation and persist the authoritative event identity before confirmation.
- [ ] Handle concurrent requests, stale slots, external calendar edits, unavailable providers and ambiguous acceptance with reconciliation and visible next actions.
- [ ] Keep requested, confirmed, attended and cancelled appointment states distinct from quotes/sales; deterministic booking fixtures exercise the real internal workflow.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 10, 56, 60, 63, 120, 148.
Source #1 acceptance scenarios: 15, 42.

<!-- ticket-plan: full-product-2026-11-05:T21 -->
