## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A platform operator manages tax obligations, due periods and reviewable liability reports from retained subscription transactions.

## Acceptance criteria

- [ ] Maintain configured registration/obligation records, reporting periods and due dates without inventing universal legal deadlines.
- [ ] Aggregate issued invoice/credit-note snapshots and applicable adjustments into explainable liability totals tied to their underlying evidence.
- [ ] Record preparer/reviewer actions, review issues and approvals; give operators a due/status view and deterministic clock-based reminders.
- [ ] Business users cannot access global tax data; preparing or approving a period does not claim it is filed or paid.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 132, 138, 140, 141, 142, 143, 144.
Source #1 acceptance scenarios: 31, 32, 35, 37, 38.

<!-- ticket-plan: full-product-2026-11-05:T49 -->
