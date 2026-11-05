## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An owner controls which prices, quotations, discounts and orders the service may handle automatically and which require approval.

## Acceptance criteria

- [ ] Default every commercial action to approval-required until an authorized owner/admin explicitly enables it.
- [ ] Persist per-Business action permissions, amount/discount limits, approval requirements and escalation owners with audit history.
- [ ] Show the effective policy and reject unauthorized or malformed changes at the server boundary.
- [ ] External messages or retrieved content cannot grant authority; changes are available for current-state evaluation at execution.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 11, 12, 58, 59.
Source #1 acceptance scenarios: 14, 28.

<!-- ticket-plan: full-product-2026-11-05:T07 -->
