## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business grants calendar access separately from mail and books through a customer-owned Google calendar.

## Acceptance criteria

- [ ] Provide Business-scoped OAuth, calendar selection, secure credential lifecycle and visible grant/readiness/reconnect/revoke states.
- [ ] Use the native supported availability/event APIs through the booking adapter; mail permission alone never implies calendar permission.
- [ ] Map rate limits, insufficient/revoked grants, conflicts and ambiguous event creation to the booking recovery contract without premature confirmation.
- [ ] Add focused provider payload/capability fixtures and a controlled live-check procedure; activation requires actual OAuth/project approval and supported account setup.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 56, 79, 95, 121, 148.
Source #1 acceptance scenarios: 15, 20, 30, 42.

<!-- ticket-plan: full-product-2026-11-05:T22 -->
