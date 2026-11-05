## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business sees whether a proposed email is eligible, and opt-outs immediately prevent covered outreach.

## Acceptance criteria

- [ ] Evaluate configured destination/recipient type, purpose, permission/relationship evidence, sender identity and opt-out rules independently of public availability or paid reach.
- [ ] Persist permission evidence, suppression scope, effective time and an explainable allowed/blocked/unknown result for the user.
- [ ] Missing required market policy or evidence blocks action rather than inventing legal permission or a universal B2B exemption.
- [ ] Apply a new opt-out or eligibility restriction atomically at dispatch, retaining relevant history and current Opportunity ownership.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 43, 45, 47, 49, 81, 85, 86, 99, 111.
Source #1 acceptance scenarios: 9, 10, 11, 23, 28.

<!-- ticket-plan: full-product-2026-11-05:T29 -->
