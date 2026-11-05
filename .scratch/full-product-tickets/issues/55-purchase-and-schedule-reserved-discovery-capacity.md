## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business with the configured paid entitlement uses reserved capacity while pooled execution remains the default.

## Acceptance criteria

- [ ] Quote and confirm configured optional reserved capacity through the subscription contract rather than assigning unapproved extra spend.
- [ ] Route queued runs to the appropriate pooled/reserved execution allowance with visible progress and capacity availability.
- [ ] Use identical Business isolation, permission, source, budget and evidence rules in both modes; dedicated capacity is not a privacy prerequisite.
- [ ] Handle entitlement change, exhaustion and retries without duplicated runs or promises of guaranteed leads/throughput beyond configured capacity.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 20, 21, 22, 23, 101, 102, 107, 118.
Source #1 acceptance scenarios: 5, 6, 7, 26, 39.

<!-- ticket-plan: full-product-2026-11-05:T55 -->
