## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A salesperson assumes control of one Opportunity, pauses its automation across channels and later explicitly resumes it.

## Acceptance criteria

- [ ] Persist assigned owner, takeover/handoff reason, next action and automation-control state with audit history.
- [ ] Apply manual replies from authorized supported channel events to the same Opportunity-wide pause; unrelated Opportunities continue.
- [ ] Require explicit authorized handback and re-evaluation of current policy before automation can resume.
- [ ] Race a manual reply/takeover against a due action through the application seam and prove the stale action cannot dispatch.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 48, 49, 59, 63, 64, 65, 66, 76, 91, 93.
Source #1 acceptance scenarios: 10, 11, 17, 18.

<!-- ticket-plan: full-product-2026-11-05:T17 -->
