# Paid pilot preparation and measured continuation

This flow records an actual agreed Business evaluation. Software records do not establish a real pilot, provider approval, legal review, customer acceptance or paid renewal. Operators supply actual evidence; users perform live acceptance.

## Agree and prepare

An owner/admin with current MFA approves the exact frozen pilot and can stop its further work even if the recorder's operator grant is withdrawn. A centrally classified `pilots.manage` operator with fresh operator MFA prepares and records operations. Deployment provisioning grants that capability; browser commands cannot grant it.

Choose the actual configured-days quote. Enter the actual offering/goal, evidenced baseline, numeric criteria, selected scope/window, cash and spend ceilings and time ceiling. The upfront pilot and original monthly quote, tax, days and allowances stay frozen. Software supplies no commercial price, budget, labor rate or hours.

Every selected provider path needs an evidenced worst-case per-call cash/spend/time ceiling. Unknown price or duration blocks execution. USD spend additionally needs an explicitly approved INR ceiling for the independent global cap. Reservations are conservative bounds, not measured expenses. Uncertain attempts stay reserved. Record actual setup/support/sales/billing-tax/maintenance effort without inventing rates; truthful overruns stop further work. Unrecorded inputs remain unknown. Reservations and actual effort are conservatively combined for enforcement.

Fresh preflight reads current actor/MFA, source/market rights, retained billing/tax evidence, global budget, retention/offboarding and each selected native path. Credentials do not establish executed Exa rights: issue #2 agreement evidence remains a human live-activation gate. Source scope must cover retention, display, export and post-cancellation use. Exact email recipient/step references receive current eligibility, suppression, market, purpose and permission checks. Sender readiness and reply visibility are independent. Mailbox, customer-controlled customer-paid Meta and each native calendar path are separate capabilities. RFQ-only evaluations need no calendar.

Approved ceilings gate real discovery calls, automated email/Meta dispatch, each mailbox provider phase and bounded calendar operations. Discovery uses its source-policy unit; automation uses a dispatch. Mailbox inspection, listing, individual body reads and grant rechecks each persist an original-actor/payload reservation before I/O and recheck approval. One provider phase can make several native HTTP requests, including scope inspection and credential refresh; its approved upper bound must cover them all. Calendar operations reserve before their provider transaction and recheck scope before and after native reads/effects; the approved bound covers the operation and its existing request timeouts. These are evidenced conservative allowances, not measured wall-clock usage or provider billing guarantees. Native paths must match the selected sender/mailbox/Meta/calendar. Current paid entitlements, permissions and existing workflow guards remain required. Independent global cost coverage must be current and priced. Customer-paid Meta is excluded from platform spend. Selected-Business DTOs contain no other Businesses' limits/customers or global cost amounts.

Expired or stopped pilots cannot authorize further pilot effects. A monthly capture establishes financial continuation evidence; it does not silently extend an expired operating approval. A further evaluation requires a new explicit bounded plan tied to an actual captured monthly period, current preflight and separate owner approval. Stop the previous operating plan before activating this phase. The original pilot remains immutable.

## Native card collection

The implementation composes documented Orders/Standard Checkout for the one-time pilot and a separately approved Subscriptions mandate for monthly continuation. This composition is an application design inference, not a Razorpay combined paid-pilot product or account confirmation. Deprecated subscription add-ons are not used. A refundable mandate authentication token does not pay for pilot days.

A deployment-owned account review supplies an exact `pilotOrders` customer-to-Business binding and independent evidence, alongside existing card/account/currency/plan restrictions. The adapter fetches the native customer and checks Business correlation. Missing evidence produces setup requirements. Browser prefill never proves customer identity. Actual merchant activation, customer binding and supported card paths require operator sandbox/live acceptance.

The server persists the original actor, frozen snapshot, operation/request/recovery identities and creation lease before I/O. After slow checks and database serialization it rechecks current authority, MFA, account review, tax and trusted database deadlines. It creates one exact tax-inclusive order with no partial payment, exact receipt and immutable correlation notes. Standard Checkout receives that server order. The callback requires server HMAC validation; access additionally requires exact native order/payment/customer/card/capture evidence. Order paid alone cannot prove current access after refund. Native payment creation time supplies the supported timestamp; no distinct capture timestamp is invented.

Uncertain order POSTs are never repeated. Recovery paginates the receipt filter, which means CONTAINS, then checks exact receipt and all frozen notes/account/mode/amount/currency fields. Duplicate or partial/ambiguous lookup remains unresolved. Absent matches do not prove no effect. The bounded lookup reads at most ten 100-item pages. No universal create idempotency header is assumed. Frozen bindings permit late incurred facts after review expiry; expiry cannot authorize new mutations.

Monthly continuation requires separate explicit approval for the original monthly price, currency, allowances and plan. Select a supported future start at or after the original pilot end and an earlier future authorization expiry. The disclosure explains the separate mandate and any service gap. Passed dates are never silently reused or shifted. Exact native subscription/invoice/card/customer captured payment proves paid renewal; authentication and `paid_count` alone do not. Later recurring periods retain their first monthly basis and existing reach-change coordination. Wrong/missing native customer correlation stays unresolved; email, phone and browser identity cannot replace it.

## Measurement, accounting and reuse

Record actual effort with evidence. Explicit attributable human expense also enters the #54 native cost inventory; a costs operator must refresh and normalize that evidence before further pilot effects when coverage is stale. The system invents no hourly rate and does not call this a provider bill or bank settlement. Results read the #53 canonical quality, engagement, sales, cohort, denominator, coverage, channel-health and source definitions. Unavailable measurements cannot satisfy criteria. The saved report retains complete metrics/coverage and an honestly paginated detail slice, assessment and attributable contribution inputs. Tax and customer-paid Meta remain separate. A recorder's completeness declaration does not verify external statements or establish full margin.

The initial canonical paid period composes with #48 invoices, #49 refund/credit allocation, #50 reconciliation and #51/#52 tax records. A new pilot order needs no existing monthly base. Native cash refund 1100 and approved seller credit 1099 remain distinct with residual 1. Original period/invoice facts remain unchanged. Current refund, dispute and cancellation evidence can invalidate renewal eligibility while history stays visible.

Record continuation only after measured results and actual canonical monthly capture. Reuse additionally requires a separately authorized, activated Business evaluation with materially different offering or goal, prepared after actual renewal. Compare actual configuration fields and retain evidence/adaptations. Only hashes/equality of the second configuration are saved in the first Business; private limits/values are not copied.

## Database and recovery

The merger owns actual deployment through full prepare/Drizzle/secure. The implementer does not access the actual target, seed production capabilities or operate actual recovery.

Three forced-RLS append-only ledgers use exact Business scopes and stable composite parent PK/FKs. Effect reservations retain original actor and immutable intent. Startup checks SELECT and INSERT separately. Runtime cannot update/delete ledgers. Prepare revokes ledger/helper access before schema work. `pilot_global_room(text,numeric,jsonb)` is private, exposes no costs and grants neither runtime nor PUBLIC execution. The seven pilot helpers require current persisted MFA and trusted database time. The recovery bundle includes the schema, helpers, native adapters and application contracts. Genuine populated archive restore and managed schema repair preserve pilot histories, reservations and unresolved original native attempts. Restored queues stay disabled and ordinary startup rejects quarantine. Restore never restarts unknown native mutations.

## Primary contracts checked 2026-11-07

- [Standard Checkout and server signature](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps), [create order](https://razorpay.com/docs/api/orders/create), [fetch orders and receipt pagination](https://razorpay.com/docs/api/orders/fetch-all).
- [Order payments](https://razorpay.com/docs/api/orders/fetch-payments), [native payment](https://razorpay.com/docs/api/payments/fetch-with-id), [payment card](https://razorpay.com/docs/api/payments/fetch-card-details-payment), [customer](https://razorpay.com/docs/api/customers/fetch-with-id).
- [Subscription create and future start restriction](https://razorpay.com/docs/api/payments/subscriptions/create-subscription), [subscription checkout](https://razorpay.com/docs/payments/subscriptions/integration-guide), [FAQ and add-on deprecation](https://razorpay.com/docs/payments/subscriptions/faqs).

These define API primitives, not our commercial/legal/account approval. Deterministic external HTTP tests exercise the selected production adapter with restricted PostgreSQL. They assert no actual customer payment, legal approval or real pilot outcome.

## User acceptance pending

1. With real reviewed account/source/tax/retention evidence and explicit bounds, prepare an actual Business evaluation. Missing paths should identify their own setup destinations.
2. Review the exact quote and bounded plan. Complete the one-time card checkout only in the operator-approved environment. Access should follow exact native capture; refresh/retry must not create another order.
3. Exercise approved paths, reduce budgets, revoke scope or record actual overruns. Further calls, including queued work, should stop while incurred facts remain visible.
4. Record measured results and actual contribution inputs. Unknown coverage must stay visible. Explicitly approve the separate monthly mandate and future schedule; only actual monthly capture validates renewal.
5. Review refunds/disputes/cancellation, seller credits/residuals and the materially different second workflow with real reuse evidence after renewal.
6. Review responsive layout, keyboard/focus/labels, feedback and separate-checkout disclosures. Rendered UI, native sandbox/live behavior and customer acceptance remain user-owned and were not performed by the implementer.
