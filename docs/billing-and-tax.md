# Direct subscription billing and tax management

Accepted 2026-11-05: sell the platform's subscriptions directly and implement billing/tax management inside the application. [ADR 0006](adr/0006-sell-directly-with-app-owned-billing-and-tax.md) supersedes the previous Paddle decision. Razorpay is the initial gateway under [ADR 0007](adr/0007-use-razorpay-for-direct-subscriptions.md), with Cashfree retained as a researched alternative if approval or terms are unsuitable.

## Architectural effect

Implement the billing/tax module within the selected Next.js, Neon, Trigger.dev, and Resend stack. Keep checkout/payment processing with a gateway's hosted components and use its supported recurring-payment/mandate flows. Application records hold provider references rather than raw card details. A payment link alone collects a payment but does not supply the application's subscription/usage lifecycle.

The application owns plan prices, Business subscriptions, billing periods, approved prorated upgrades, renewal-time downgrades, and reach/usage entitlements. Require trusted payment confirmation, durable signature-checked webhook receipt, duplicate/out-of-order event handling, and reconciliation of missing events. Gateway-specific capabilities must be verified for the selected integration. [Razorpay subscription capability example](https://razorpay.com/docs/payments/subscriptions), [webhook verification and event ordering](https://razorpay.com/docs/webhooks/validate-test).

## Application capabilities

| Capability | Required behavior | Application responsibility |
| --- | --- | --- |
| Billing profile | Business legal name, billing address/country, invoice email, applicable tax identifier and retained business-status evidence. | Our records must support our seller invoices and tax treatment; missing tax IDs do not automatically mean exemption. |
| Checkout and payment status | Server-derived price/currency, provider customer/order/payment references, signed callbacks/webhooks, reconciliation; do not grant access from a browser redirect alone. | Persist payment and reconciliation state, enforce idempotency and authorize resulting billing/access changes. |
| Subscription and entitlements | Billing period, paid-through time, pending/active/past-due/cancelled states, defined grace rules, payment-method update links, plan-change charges, reach and usage limits. | Use provider recurring billing where supported. Reconcile its payment/mandate states with our application; feature parity varies by method/currency. |
| Tax treatment and calculations | Manage effective-dated jurisdiction rules/rates, registration status, tax identifiers, evidence, and approved tax treatment. Calculate and retain line/tax totals and the decision used for each transaction; route unresolved treatment for review. | Build configurable tax management and calculations in the app. Store rule versions/approvals and preserve transaction snapshots; missing identifiers or foreign addresses do not automatically establish exemption/export treatment. |
| Invoices and credit notes | Numbered seller invoices with preserved transaction/customer/tax details, PDF/download history, tax adjustments and credit notes when needed. | Issue and retain our seller documents inside the app, with controlled numbering, currency rounding, reviewed templates and accounting exports. A gateway receipt is not automatically the required tax invoice. |
| Tax registrations and obligations | Track relevant jurisdiction/registration records, reporting periods, due dates, liability totals, preparer/reviewer actions, and filing/remittance status. | Provide reports, exports, document/evidence attachments, recorded submissions/payments and acknowledgements. Add external filing/payment adapters only for explicitly supported jurisdictions; a prepared report is not a confirmed filing. |
| Refunds and disputes | Full/partial refund records, processing/result states, supporting evidence, customer notifications and operator actions; reconcile effects on invoices and entitlements. | Our company manages the merchant process with the gateway, including tax/accounting corrections and dispute responses. Hosted tools can reduce UI work but do not transfer ownership. |
| Financial reconciliation | Link invoice -> gross payment -> refund/fees/taxes/FX -> settlement -> bank payout; export records and remittance references. | Maintain the subscription billing/tax subledger and exception resolution inside the app, with exports for wider business accounting. |
| Customer/operator billing tools | Invoice history, update-payment/cancel actions, failed-payment notifications, searchable billing history, reconciliation exceptions and audit trail. | Reuse provider portals/dashboard functions where adequate; implement missing workflows and keep Business authorization in the app. |

These capabilities are approved scope, not implemented modules. The module manages the operator's platform-subscription sales and related tax obligations. Business Owner/Admin access is limited to that Business's billing records; platform-wide tax rules, registrations, filings and financial reconciliation require authorized platform-operator capabilities. All adjustments and approvals retain an audit trail.

Initial billing currencies are INR for Indian Businesses and USD for international Businesses; other billing currencies follow later. Billing country is separate from discovery geography, and processor settlement currency may differ from the invoice. Maintain both transaction and settlement amounts/currencies with their exchange-rate/fee evidence. The internal cost ledger's planning rate is not an approved customer pricing rule.

Our subscription seller invoices cover our platform/automation charges. The selected direct Meta arrangement has each Business pay Meta's messaging bill separately; disclose that customer-paid provider charge in quotes/usage views without duplicating it as prepaid Meta credit or operator-paid spend in our own tax/revenue ledger.

Start automatic subscriptions with supported cards in INR/USD. UPI AutoPay follows validation of the separate upgrade/new-mandate workflow. Eligible international-card subscriptions can use native proration; domestic cards have different update restrictions, so define a supported authorized checkout/mandate path rather than assuming universal native updates. Defer eMandate and other unselected recurring methods.

Razorpay's actual activation, supported card/currency combinations, surcharge/FX terms, numeric grace rules, actual prices and invoice numbering/rounding rules, enabled jurisdictions, legal tax configuration and any external filing/payment adapters remain inputs before the corresponding live capability. Preserve issued documents and treatment snapshots when customer details, rules, registrations or prices later change. See [payment-gateways.md](payment-gateways.md) for comparison and selection details.

## Business and accountant responsibilities

The business remains responsible for registrations, tax judgments, LUT/bond applications where applicable, return filing, remittance and foreign registration obligations. Implement management of those obligations, evidence, approvals, reports and status inside the app; authorized people or supported integrations perform the actual external submissions/payments. Record confirmations and reconcile liability against filed/paid amounts. A tax-calculation add-on does not make the processor a Merchant of Record. [Processor merchant tax responsibilities, section 7.3](https://stripe.com/in/legal/ssa).

Indian GST export treatment depends on all statutory conditions, including recipient/place of supply outside India and eligible payment receipt; foreign address/currency or a Business checkbox is insufficient. Retain invoice/customer/payment evidence and explicitly record the accountant-approved treatment. [IGST Act, section 2(6)](https://www.indiacode.nic.in/bitstream/123456789/2251/1/A201713.pdf).

B2B also is not a worldwide blanket exemption. EU guidance, for example, describes reverse charge for many business purchases of services from outside the EU: the buyer accounts for applicable VAT rather than the transaction having no tax obligations. Record business status, relevant identifiers and the treatment applied. [EU cross-border VAT](https://europa.eu/youreurope/business/finance-and-tax/vat/cross-border-vat/index_en.htm).

Invoice fields, endorsements and credit-note rules must be checked against the current rules applicable to the seller/transaction before implementation. A historical CBIC consolidated Rules PDF supports the general invoicing/remittance-evidence background but is not treated as a fully current rulebook; no exact filing deadline or universal FIRC requirement is assumed here.

## Operating cost effect

- Paddle is removed from the selected services and active cost forecast. Its historical standard fee was the comparison reference; because it had no fixed monthly fee, this change does not itself reduce the selected USD 30/month infrastructure commitments.
- Razorpay is selected; its payment-method, international, recurring-billing, FX, refund/dispute and applicable invoice-tax costs must use the actual account terms. Provisional fee scenarios are in [operating-costs.md](operating-costs.md); the recurring surcharge and FX quote are not yet confirmed.
- Track the module's database/storage/worker/email usage, document rendering, any optional external tax/accounting/filing adapters, accountant/filing work, and billing support/maintenance. These are unpriced; no external tax SaaS is selected by this decision.
- Direct-selling operating cost is `existing infrastructure + incremental billing/tax infrastructure usage + gateway/FX/refund/dispute costs + any chosen external services and administration`. Engineering effort and continuing maintenance are separate costs; savings versus the historical MoR option require an actual gateway quote and workload estimate.

## Verification at the application seam

Use deterministic gateway, filing/remittance and clock adapters with the application's real billing/tax logic. Verify tax/evidence review, effective-dated rates and frozen issued invoices, rounding and totals, invoice/credit-note history, confirmed payments and approved entitlements, duplicate/out-of-order events, failed/recovered payments, partial refunds/disputes, settlement differences, filing/remittance records and acknowledgements, reports/audit and Business/platform access boundaries. Provider-contract checks follow once real integrations are selected.

Direct global self-service requires supported countries/currencies/tax workflows to be established before opening checkout there. Provider acceptance of the actual discovery/outreach product remains a prerequisite. This is configuration of declared coverage, not a claim that every jurisdiction is already implemented.

Sources: [Paddle pricing](https://www.paddle.com/pricing), [Razorpay pricing](https://razorpay.com/pricing/), [international payments](https://razorpay.com/docs/payments/international-payments), [selected cost ledger](operating-costs.md).
