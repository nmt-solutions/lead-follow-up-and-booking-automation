## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business completes commercial actions within its configured authority and sends exceptions for explicit approval.

## Acceptance criteria

- [ ] Evaluate the current action permission and limits for proposed prices, custom quotes, discounts and order commitments.
- [ ] Provide an actionable approval/rejection flow and execute only the approved immutable action or explicitly enabled in-limit automation.
- [ ] Record issued quotes, accepted orders and confirmed sales only from authoritative Business/provider evidence; keep them distinct from RFQs and appointments.
- [ ] Recheck permission changes and takeover at execution, deduplicate retries and surface ambiguous external results without blind repetition.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 11, 12, 58, 59, 60, 63, 116.
Source #1 acceptance scenarios: 14, 15, 28, 29.

<!-- ticket-plan: full-product-2026-11-05:T20 -->
