## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An owner reviews and approves a fixed recipient set, initial messages and bounded follow-up sequence before first contact.

## Acceptance criteria

- [ ] Review recipient/evidence selection, channel, initial draft, follow-up content/timing, maximum attempts and stop conditions.
- [ ] Persist an immutable approval version and authorized actor; revisions or newly discovered recipients require their own approval.
- [ ] Show eligibility/readiness and current authority separately from approval; approval alone cannot dispatch or bypass suppression.
- [ ] Store inspectable action/approval history and prove no send is produced by discovery, drafting or an unapproved recipient change.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 41, 42, 43, 44, 45, 49, 50, 99.
Source #1 acceptance scenarios: 9, 10, 23, 28.

<!-- ticket-plan: full-product-2026-11-05:T30 -->
