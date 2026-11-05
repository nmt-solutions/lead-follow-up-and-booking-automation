## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

The Business and operator see sender-specific authentication, bounce or complaint failures and recover safely without losing inbound work.

## Acceptance criteria

- [ ] Ingest authenticated provider/connection health evidence and evaluate configured bounce, complaint and authentication thresholds.
- [ ] Pause affected outbound actions and alert the responsible Business/operator while retaining incoming mail, records and unrelated healthy work.
- [ ] Explain the failure, remediation and current readiness; resolution requires evidence that the underlying condition is repaired, not a blind resume toggle.
- [ ] Recheck health at dispatch and test duplicate health events and a concurrent due action without duplicate notifications or sends.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 79, 81, 82, 83, 84, 86, 109, 115, 119, 124.
Source #1 acceptance scenarios: 10, 18, 22, 29, 41.

<!-- ticket-plan: full-product-2026-11-05:T35 -->
