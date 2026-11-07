# Approved reach changes

Reach changes freeze a versioned financial and operational agreement. Business approval authorizes the saved change, including its exact prorated tax, renewal price, geography, allowance disposition and card path. Provider acknowledgements, authentication transactions and checkout returns do not pay for reach.

## Deployment inputs

Configure the existing reviewed Razorpay card account and exact monthly target-plan mappings, current pricing, billing evidence and approved tax rules. Preserve the original merchant, mode, currency and customer. Native plans must match the reviewed gross amount, monthly frequency and collection count. Enable international native proration only after verifying this merchant's eligibility and exact proration behavior. Domestic plan changes use a replacement card mandate and a separate delta order.

`SUBSCRIPTION_REACH_POLICY` is a deployment-controlled JSON object validated by `reachPolicySchema` in `src/models/reach-changes.ts`. Supply attributable, effective commercial and legal evidence for:

- `id`, positive `version`, `mode`, `reviewedBy`, `checkedAt`, `effectiveFrom`, `effectiveUntil`, and nonempty `evidence`.
- `previewSeconds` (1–86400), `proration` (`remaining_calendar_seconds` or `remaining_utc_days`), `rounding: "half_up"`, and `unusedUnits: "retain_consumed_add_prorated_difference"`. Day proration also requires an explicit `utcDayCutoff`: `start_of_current_utc_day` or `start_of_next_utc_day`.
- `inFlightUnengaged: "pause_outside_target"`. `unknown` gates approval and activation. This decision must be explicitly reviewed for already-running unengaged campaigns.
- `nativeProration: { enabled, evidence }` and `replacement: { enabled, stopOldBeforeCreate: true, evidence }`. Disabled paths remain gated. Evidence must establish the merchant's supported card flow and the consequences of stopping the old renewal before authentication completes.

Never replace a policy or account-review version with different contents. Create a new version and obtain fresh approval. Missing, expired or contradictory configuration produces an actionable setup/review state. Native exact-price changes after preview require a fresh preview; a proven unsent approval can be withdrawn without erasing its history. An ambiguous attempted effect cannot be withdrawn or blindly repeated.

Proration uses the original actual UTC period boundaries, including short February periods. Used/reserved units remain on the original period; only the prorated difference is added. No universal thirty-day period or allowance conversion is assumed. Mixed price/market/allowance directions and negative line deltas require a separately reviewed commercial choice rather than an inferred credit.

## Native execution and recovery

Eligible international cards use documented `PATCH /v1/subscriptions/:id` parameters. Immediate expansion requires the corresponding independently fetched paid difference invoice and captured card payment, matching the frozen customer, order, currency, amount and time window. Reductions use `schedule_change_at: "cycle_end"`, verify scheduled target details, and activate only with the eligible captured target renewal.

Domestic and configured replacement flows first persist and confirm the old subscription's cycle-end cancellation. They then create a genuine future subscription with `start_at` at the old paid-through boundary. Checkout uses its saved `subscription_id` and original `customer_id`. A signed authenticated-subscription receipt and independently fetched matching card authentication payment establish the mandate. They grant no expansion. A separate server-created order fixes the exact delta amount; only its captured card payment funds expansion. Unexpected later charges on the stopped old subscription remain financial history and cannot restore paid scope. An incomplete replacement can leave a renewal gap, disclosed before approval. A second replacement during that same original term requires review rather than creating another mandate.

The replacement's reviewed target-plan collection count is displayed and frozen in the exact approval; it may differ from the stopped subscription's original total or remaining count. Native updates retain the approved remaining count. The documented Checkout customer parameter selects the saved customer; it is not a server-side customer or method lock. Independently observed subscription and card-payment customer identities must still match the original customer before proceeding. Both documented `https://rzp.io/i/<id>` and `https://rzp.io/rzp/<id>` subscription links are accepted with a strict origin/path check and no userinfo, query or fragment. Links and redirects confer no financial authority.

There is no invented monetary-preview API, universal update idempotency header or deprecated add-on collection. Each exact mutation body and attempt is durable before I/O. Unknown outcomes are reconciled using saved native identity/notes/receipt, without another mutation. A final authority check follows external reads immediately before every mutation. The current actor, Business permission/MFA, account review, pricing, tax, policy and paid source are rechecked. Another current operator can execute an existing intent using a new attributable action; request UUIDs remain bound to their original actor and payload.

The existing Trigger subscription recovery task performs factual reach recovery before and after ordinary payment reconciliation. It never needs the initiating browser session and does not issue new native mutations. Provider/account review changes can gate activation while already incurred factual money remains durable. Configure the existing recovery schedule, authenticated webhook and certificate-verifying restricted database connection. Effect remains limited to discovery orchestration.

## Canonical financial and access contract

Every captured delta creates its own immutable `subscription_payment` and `subscription_period` financial source with `snapshot.adjustment.kind = "reach_delta"`. It carries the original period, approved quote and pricing delta, exact proration, policy, consumed units, scope, tax lines and captured native identity. It is excluded from ordinary renewable-term selection and ordinary payment recovery. The original period, quote, tax and issued documents stay immutable.

Seller documents issue against this new captured source. The final #49 refund/dispute workflow uses its own original-tax allocation, native cash, approved credit and explicit residual contracts. A standalone order legitimately has no native subscription invoice. A configured `block_period` financial effect on a delta retracts that expansion and any later expansion dependent on its funding, while the original paid term remains eligible unless its own financial/lifecycle state blocks it. Execution also rechecks that the approved source expansion remains effective. Paid target renewal terms retain their own financial identity.

`current_paid_scope` is the authoritative market/allowance projection used by discovery, saved schedules, campaigns, sequences and Meta. `current_paid_contract` and `readPaidContract` expose the same effective period plus offer and reserved-capacity metadata for capacity/pilot/future payment-method composition. This minimal projection contains no prices, billing evidence, recovery capability or channel permission. Paid reach never authorizes sending.

A replacement reduction can activate its independently captured new term after the old native subscription reaches this change's confirmed stop at the exact approved boundary. The old action remains cancelled. An earlier end or an unrelated customer cancellation still gates activation; cancellation never becomes a payment or rewrites the original financial history.

Queued acquisition and existing saved searches revalidate current scope. Unengaged campaign work outside reduced reach pauses; historical prospects/evidence and incoming/engaged conversations remain available. Renewal reductions require an actual eligible target charge, not merely the calendar boundary.

## Manual launch and acceptance

Actual merchant activation, commercial/legal/tax review, card eligibility and customer checkout acceptance remain deployment inputs. No live provider or charge action is implied by automated fixtures.

1. With a confirmed paid Business, create a current monthly target quote, open **Reach changes**, and preview. Expect exact tax, total, UTC boundary, scope, consumed units, policy version, expiry and recurring price before approval.
2. Approve the exact terms. Before confirmed matching capture, expect the old reach. Eligible international capture expands it once; a declined or ambiguous response stays pending/review without duplicate charges.
3. For a domestic card, expect the old renewal stop, future mandate authentication, then separate exact delta payment. Closing checkout or its authentication token must not expand reach. Captured delta expands once. At renewal, only the actual replacement target charge grants the new term.
4. Approve a reduced target. Expect unchanged current reach, then reduced future discovery/new-prospect reach after the eligible captured renewal. Test a saved search and queued acquisition outside that reach: they pause/block. Retained prospects, evidence, incoming and engaged conversations remain visible.
5. Issue the delta seller invoice and exercise a separately approved refund through Financial adjustments. Expect exact original delta tax and credit/cash history; configured blocking retracts only expansion. Original documents and payment history remain unchanged.
6. Review keyboard/focus, errors/MFA recovery, compact and desktop layouts, enlarged text, light/dark appearance and accessibility preferences. Browser/UI validation and user acceptance are pending.

## Primary provider references

Verified against current primary documentation during implementation:

- [Update restrictions and proration](https://razorpay.com/docs/payments/subscriptions/update), [update API](https://razorpay.com/docs/api/payments/subscriptions/update-subscription), and [scheduled-change lookup](https://razorpay.com/docs/api/payments/subscriptions/fetch-pending-update-details).
- [Cycle-end cancellation](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription), [future subscription creation](https://razorpay.com/docs/api/payments/subscriptions/create-subscription), [subscription entity](https://razorpay.com/docs/api/payments/subscriptions/entity), and [subscription Checkout integration](https://razorpay.com/docs/payments/subscriptions/integration-guide).
- [Exact server order creation](https://razorpay.com/docs/api/orders/create), [order payment lookup](https://razorpay.com/docs/api/orders/fetch-payments), [Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps), and [saved customer card Checkout](https://razorpay.com/docs/payments/payment-methods/cards/features/integrate-saved-cards).

Documentation defines the executable contract; merchant-specific eligibility, activation and proration evidence are separately required by runtime configuration.
