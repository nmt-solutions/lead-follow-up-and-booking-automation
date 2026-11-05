## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An authorized user uploads a Business document and retrieves it privately with visible ownership and retention status.

## Acceptance criteria

- [ ] Implement private R2 upload completion, ownership metadata, configured file/type/size limits and short-lived authorized access.
- [ ] Use the selected US jurisdiction without claiming Virginia placement; keep storage and request allowances account-wide rather than per Business.
- [ ] Reject cross-Business access, expired links, uncompleted uploads and disallowed files; expose failures and cleanup state.
- [ ] Apply configured retention/deletion rules and usage attribution without inventing production limits or keeping public object URLs.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 9, 118, 140, 141.
Source #1 acceptance scenarios: 5, 38, 41.

<!-- ticket-plan: full-product-2026-11-05:T06 -->
