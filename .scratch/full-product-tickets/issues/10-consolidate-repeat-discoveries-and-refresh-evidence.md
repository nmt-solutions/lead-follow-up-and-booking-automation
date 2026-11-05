## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

Repeated runs update the same Business's prospects while preserving source history and honest request freshness.

## Acceptance criteria

- [ ] Consolidate overlapping company/contact results within a Business without merging another Business's records or unrelated purchasing needs.
- [ ] Refresh source evidence and check dates while retaining provenance for changed contact roles, uncertain facts and expired requests.
- [ ] Surface conflicting evidence for review rather than fabricating certainty; show duplicate/refresh outcomes in run and prospect views.
- [ ] Re-running identical input is idempotent for retained prospect identity and meaningful metrics.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 26, 28, 29, 30, 37, 39, 122.
Source #1 acceptance scenarios: 3, 4, 5, 29.

<!-- ticket-plan: full-product-2026-11-05:T10 -->
