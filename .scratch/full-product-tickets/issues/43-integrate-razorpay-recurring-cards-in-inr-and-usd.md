## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

Eligible Businesses purchase and renew card subscriptions through the selected Razorpay gateway and see supported-method readiness.

## Acceptance criteria

- [ ] Use hosted card/mandate flows and native signature-validated webhooks without storing raw card details; retain customer/payment/subscription references.
- [ ] Validate actual domestic/international card and INR/USD account capabilities, event payloads, renewal behavior and INR settlement through focused sandbox/provider contracts.
- [ ] Record activation, recurring surcharge, fees and FX terms as explicit account inputs; unsupported methods/currencies remain unavailable and Cashfree is not silently enabled.
- [ ] Reconcile missing or ambiguous authoritative events into the application's subscription contract; UPI/eMandate are not enabled by this card integration.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 101, 103, 107, 130, 131, 136, 137, 139.
Source #1 acceptance scenarios: 30, 33, 34, 36.

<!-- ticket-plan: full-product-2026-11-05:T43 -->
