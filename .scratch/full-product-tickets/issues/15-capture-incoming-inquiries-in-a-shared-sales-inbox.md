## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business receives an inquiry, opens it in a shared inbox and sees its buyer, conversation and initial Opportunity.

## Acceptance criteria

- [ ] Accept scoped incoming events through an adapter boundary and persist buyer, conversation/message and initial Opportunity records for authorized inbox views.
- [ ] Deduplicate provider events and validate Business/connection ownership; replaying an event cannot create another inquiry or Opportunity.
- [ ] Mark direct inquiries and buying-interest replies as engagement; public discovery signals alone remain prospects.
- [ ] Handle incoming inquiries from outside paid discovery geography under communication/authority policy rather than rejecting them solely for reach.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 40, 51, 52, 60, 63, 100, 113, 118.
Source #1 acceptance scenarios: 11, 12, 16, 27.

<!-- ticket-plan: full-product-2026-11-05:T15 -->
