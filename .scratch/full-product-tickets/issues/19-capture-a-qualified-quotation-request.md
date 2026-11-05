## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A product-led Business collects a complete RFQ and moves it through its native quotation-request workflow without a calendar dependency.

## Acceptance criteria

- [ ] Collect configured product/service specifications, quantities, constraints and missing requirements into the relevant Opportunity.
- [ ] Show RFQ completeness, responsible owner and next action; support review/update without implying that a quote has been issued or a sale made.
- [ ] Keep separate requests for distinct purchasing needs and retain supporting conversation/evidence.
- [ ] RFQ-only progress works without calendar grants or a scheduling provider; unauthorized and duplicate actions are rejected safely.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 10, 57, 60, 61, 63, 148.
Source #1 acceptance scenarios: 13, 15, 16, 42.

<!-- ticket-plan: full-product-2026-11-05:T19 -->
