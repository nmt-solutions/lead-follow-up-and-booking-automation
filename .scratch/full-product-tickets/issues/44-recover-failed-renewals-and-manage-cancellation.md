## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business sees failed-payment status, updates its payment method and renews or cancels under explicitly configured lifecycle rules.

## Acceptance criteria

- [ ] Persist pending/active/past-due/cancelled states, paid-through dates and explicit configured grace/cancellation policy; missing policy blocks the corresponding production transition.
- [ ] Expose supported update-payment/recovery/cancel actions and customer notification effects without granting an unconfirmed paid period.
- [ ] Reconcile retries and out-of-order renewal/cancellation events exactly once; preserve existing records and incoming/engaged work according to policy.
- [ ] Use the controlled clock to prove lifecycle boundaries, access changes and recovery while preserving immutable payment history.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 104, 105, 106, 115, 136, 137, 143.
Source #1 acceptance scenarios: 27, 33, 34, 38.

<!-- ticket-plan: full-product-2026-11-05:T44 -->
