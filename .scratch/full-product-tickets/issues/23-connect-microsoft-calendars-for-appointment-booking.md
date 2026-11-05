## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business books through its Microsoft calendar using an account-appropriate availability path and separate calendar authorization.

## Acceptance criteria

- [ ] Connect and select a Business-controlled calendar with secure separate grants, readiness, reconnect and revoke behavior.
- [ ] Support the validated work/school free-busy path and personal Outlook calendar-view/event-read path; do not claim unsupported getSchedule capability for personal accounts.
- [ ] Create and reconcile authoritative events through the shared booking contract, handling conflicts, permission loss, duplicates and provider timeouts.
- [ ] Use deterministic account-capability fixtures and focused provider contracts; unsupported account combinations stay explicitly unavailable.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 56, 79, 95, 121, 148.
Source #1 acceptance scenarios: 15, 20, 30, 42.

<!-- ticket-plan: full-product-2026-11-05:T23 -->
