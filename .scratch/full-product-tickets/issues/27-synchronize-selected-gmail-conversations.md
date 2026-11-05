## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business connects Gmail and sees selected inquiries and manual replies synchronize into its sales workflow.

## Acceptance criteria

- [ ] Use native Gmail OAuth/API with Business-scoped encrypted tokens, refresh/reconnect/revoke and separate read/send grants.
- [ ] Honor selected mail/history scope, maintain incremental synchronization and recover cursor/watch gaps without duplicate messages or speculative complete-history claims.
- [ ] Associate incoming/manual replies with the correct Opportunity, stop stale unanswered sequences and invoke the shared human-takeover behavior.
- [ ] Surface synchronization visibility failures and pause affected follow-ups while preserving inbox/history; retain production verification/security-assessment prerequisites and costs.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 51, 67, 72, 73, 74, 75, 76, 77, 78, 79, 80, 113, 115.
Source #1 acceptance scenarios: 11, 12, 17, 18, 20, 21.

<!-- ticket-plan: full-product-2026-11-05:T27 -->
