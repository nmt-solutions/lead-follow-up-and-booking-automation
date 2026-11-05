## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business chooses which sales mail is processed and explicitly opts into a bounded historical import.

## Acceptance criteria

- [ ] Persist Business/mailbox ownership, separately requested read/send grants, selected processing scope and import bounds.
- [ ] Default history import off; show reviewable import state and exclude unrelated or out-of-scope mail.
- [ ] Apply changed scope/revocation to subsequent synchronization and processing without leaking content from other mailboxes or Businesses.
- [ ] Exercise deterministic incremental/history sync events, cursors and deduplication against the real inbox and permission state.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 67, 73, 74, 75, 77, 78, 118.
Source #1 acceptance scenarios: 18, 20, 21.

<!-- ticket-plan: full-product-2026-11-05:T26 -->
