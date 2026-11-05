## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An operator validates the separate UPI upgrade/new-mandate path before optionally enabling UPI AutoPay for eligible subscriptions.

## Acceptance criteria

- [ ] Keep UPI disabled during the initial cards-only release and recheck current gateway/account support before implementation.
- [ ] Demonstrate the required approved payment/new-mandate flow, failed/recovered authorizations, renewal cancellation and idempotent entitlement transitions.
- [ ] Do not treat UPI subscription changes as equivalent to eligible international-card updates or migrate an existing mandate silently.
- [ ] Record supported account/method limits and sandbox/provider evidence; activation requires the explicit validated configuration and customer approval.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 103, 104, 107, 130, 136, 137.
Source #1 acceptance scenarios: 30, 33, 34.

## Activation stage

Deferred after recurring cards; does not block the initial pilot

<!-- ticket-plan: full-product-2026-11-05:T59 -->
