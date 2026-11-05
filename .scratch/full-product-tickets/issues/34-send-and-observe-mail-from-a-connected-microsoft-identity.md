## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

Approved application actions send through the Business's Microsoft mailbox with correlated and accurately labeled observations.

## Acceptance criteria

- [ ] Require separate sending grants, current Business identity/reply readiness and shared dispatch policy checks.
- [ ] Use the native Graph mail adapter to send an authorized action and retain provider/Business/thread references for reconciliation.
- [ ] Keep provider acceptance, Sent-folder evidence and delivery claims distinct; resolve ambiguous acceptance without a blind duplicate send.
- [ ] Exercise revoked grants, account capabilities, provider limits and external manual activity through focused contracts and application scenarios.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 45, 50, 67, 71, 72, 74, 75, 76, 80, 81, 86, 114.
Source #1 acceptance scenarios: 10, 12, 19, 20, 23.

<!-- ticket-plan: full-product-2026-11-05:T34 -->
