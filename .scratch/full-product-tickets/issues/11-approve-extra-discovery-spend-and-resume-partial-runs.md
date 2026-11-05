## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business inspects a stopped run and explicitly approves a bounded increase before research continues.

## Acceptance criteria

- [ ] Show authorized allowance, consumed/reserved usage, completed results and the reason execution stopped.
- [ ] Require an authorized, attributable increase or extra-usage approval; do not create an invented price or bill when commercial configuration is absent.
- [ ] Continue/retry against the remaining approved allowance without duplicate reservations, duplicated retained results or multiplied provider/Effect/task retry budgets.
- [ ] Concurrent workers cannot overspend the authorized run allowance through non-atomic checks; cancellation and failed work settle reservations deliberately.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 23, 24, 25, 102, 107, 117.
Source #1 acceptance scenarios: 7, 28, 29.

<!-- ticket-plan: full-product-2026-11-05:T11 -->
