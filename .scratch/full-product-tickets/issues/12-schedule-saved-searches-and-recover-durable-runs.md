## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business saves a Discovery brief and runs it on its local schedule without losing or duplicating work after a worker restart.

## Acceptance criteria

- [ ] Save, edit, pause and resume a search schedule with an explicit Business time zone and configured timing rules.
- [ ] Use Trigger.dev for persisted dispatch/scheduling/recovery; Effect remains inside the discovery attempt rather than replacing durable execution.
- [ ] Recheck current reach, approved budget, capabilities and access when each run starts, including after a restart or configuration change.
- [ ] Prevent duplicate scheduled runs and preserve partial progress/results; show queue/run state and accountable failure reasons.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 16, 17, 20, 22, 49, 112, 117, 120.
Source #1 acceptance scenarios: 5, 6, 8, 28.

<!-- ticket-plan: full-product-2026-11-05:T12 -->
