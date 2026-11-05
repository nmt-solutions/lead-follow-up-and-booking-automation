## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An operator configures supported tax treatment and a Business sees a calculated or review-required subscription total.

## Acceptance criteria

- [ ] Manage effective-dated jurisdiction/registration/rate rules and approvals under platform-operator authorization; preserve which versions and evidence produced a calculation.
- [ ] Calculate currency-precise line/tax totals with configured rounding and explicit reviewed treatment; support deterministic domestic/international fixtures.
- [ ] Route missing/conflicting evidence or unsupported jurisdiction treatment for review; never infer a worldwide B2B exemption or zero tax from foreign address/currency.
- [ ] Show review reasons and authorized resolution through UI/API/persistence, with a complete audit and no rewrite of prior approved financial snapshots.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 132, 133, 135, 140, 143, 144.
Source #1 acceptance scenarios: 31, 32, 38.

<!-- ticket-plan: full-product-2026-11-05:T41 -->
