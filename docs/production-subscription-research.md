# Lead Relay production subscription research

Checked: **2026-11-10**. Currency: USD for vendor list prices; INR for proposed Indian customer plans. Official public sources were checked on this date unless a retrieval limitation is stated. Account contracts, actual invoices and subsequently changed prices take precedence.

This is a research and implementation handoff, not evidence of merchant approval, executed procurement, legal compliance, installed configuration, measured production costs or a deployment. Only this Markdown file was changed by the researcher. The parent owns implementation, account operations and deployment.

## Recommended commercial shape

Sell **one monthly subscription per Business, with a shared usage pool for its authorized team**. This matches [ADR 0006](adr/0006-sell-directly-with-app-owned-billing-and-tax.md), [ADR 0007](adr/0007-use-razorpay-for-direct-subscriptions.md), [subscription quotes](subscription-quotes.md) and [paid scope/consumption](subscription-payments.md). Lead Relay remains the direct seller; Razorpay processes payment and is not the Merchant of Record for these sales.

The existing quote, captured subscription period and usage records are Business scoped. Discovery has configurable resource units; outbound automation consumes `provider calls`. A public contact is not permission to send, and a discovered Prospect is not an Engaged lead. Charging per seat would require a new commercial and enforcement contract: no seat billing, seat allowance multiplier or paid seat ceiling was established by this research. An extra team member shares the same pool. Vercel deployer seats and Trigger organization members are operator infrastructure seats, not customer seats.

Offer ordinary monthly purchase as the default. Do not require a sales call or paid pilot to buy an available plan. Preserve a separately disclosed, bounded Paid pilot only where its complete native payment and renewal workflow is enabled. Publish only actually available markets and features. International USD offers remain separate prices and require separately approved payment and tax coverage; the INR planning conversion below does not create USD catalog prices.

## Verified vendor rates

### OpenAI: economical text inference

Standard text rates, **USD per 1 million tokens**, excluding tools, special processing modes and tax:

| Model          | Uncached input | Cached input | Output | Current qualification                                                                                      |
| -------------- | -------------: | -----------: | -----: | ---------------------------------------------------------------------------------------------------------- |
| `gpt-6-luna`   |           0.10 |         0.01 |   0.50 | Current economical candidate; evaluate task quality and account access. Cache writes are 0.125/M.          |
| `gpt-4.1-mini` |           0.40 |         0.10 |   1.60 | Still documented, but deprecated; do not choose it as a long-lived dependency without a migration.         |
| `gpt-5-mini`   |           0.25 |        0.025 |   2.00 | Also marked deprecated on its model page; lower input price does not establish a lower complete-task cost. |

Sources: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini). The [official deprecation schedule](https://developers.openai.com/api/docs/deprecations) lists GPT-4.1 mini shutdown on **2027-01-14**, with `gpt-6-luna` as the replacement. This is a material change from treating GPT-4.1 mini as an indefinite production default.

For Luna, prompts above 272K input tokens incur higher whole-request rates; regional processing and Fast mode also add premiums. The estimates below assume ordinary Standard requests well below that threshold, with no built-in web search, image/audio tools, cache-write dependence or Batch/Flex discount. Count billable reasoning output as output. Pin and evaluate the production model, bound input/context and output tokens, and account for all attempts. [Luna pricing and modes](https://developers.openai.com/api/docs/models/gpt-6-luna)

The plan model deliberately budgets at **0.40/M input and 1.60/M output**, despite Luna's lower current prices. This is a conservative planning envelope for these two named models, not a guarantee about future model prices or arbitrary fallback models. At 2M input + 0.5M output, that costs **USD 1.60**, versus Luna's current **USD 0.45**. Existing ChatGPT/API grants and vendor promotions are excluded from recurring unit economics. An existing subscription's allocated cash expense must still be accounted for separately. [Existing allocation ledger](operating-costs.md)

Vercel AI Gateway advertises no model-price markup, including BYOK. Provider inference, fallback and optional add-ons still need separate budgets; do not count the same provider tokens twice or assume a Gateway budget also caps the OpenAI account. [Gateway pricing](https://vercel.com/docs/ai-gateway/pricing)

### Exa: bounded Search and Contents

| Meter                                 |                      Current public rate |
| ------------------------------------- | ---------------------------------------: |
| Lite Search, up to 10 results/request |                   USD 4 / 1,000 requests |
| Auto Search, up to 10 results/request |                   USD 7 / 1,000 requests |
| Each returned result above 10         |         USD 1 / 1,000 additional results |
| Contents                              | USD 1 / 1,000 pages **per content type** |
| Exa-generated page summaries          |          USD 1 / 1,000 pages, additional |
| Deep / deep-lite Search               |                  USD 12 / 1,000 requests |

Use Search metadata plus one selected Contents type (`text` **or** `highlights`); requesting both has separate content meters. Do not include Deep, Agent, enrichment, Connect providers, subpage expansion or summaries in the proposed plans. Public self-service is PAYG with no minimum and a monthly USD 10 free balance; do not allocate that shared balance separately to each Business. [Exa pricing documentation](https://exa.ai/docs/admin/pricing), [public plans](https://exa.ai/pricing)

Example, calculated without credits: 100 Auto requests + 200 single-type Contents pages cost `100 × 0.007 + 200 × 0.001 = USD 0.90`. Ten results/request means up to 1,000 raw result positions, not 1,000 unique, suitable, contactable or qualified leads. Search quality, duplicates, evidence and contact availability determine useful output. Bound `numResults`, query count, Contents URLs, content types, retained characters, attempts and the AI review context. [Search API](https://exa.ai/docs/reference/search), [Contents API](https://exa.ai/docs/reference/get-contents)

The repository's [Exa activation contract](exa-discovery.md) requires an executed MSA/order, commercial terms and express durable fact/excerpt, customer display/export, post-cancellation and AI-processing rights. Public PAYG prices do not satisfy that gate. The current official [MSA landing page](https://exa.ai/msa) links the [September 2026 agreement](https://exa-public.s3.us-east-1.amazonaws.com/Exa%20-%20Online%20Master%20Subscription%20Agreement%20%28v2.2026-09-17%29.pdf). Its license is tied to the order, permits end-user use through customer products, and imposes downstream use restrictions. An executed agreement and source-rights review remain necessary; an unsigned public document establishes neither this merchant's rights nor a zero contract minimum.

### Trigger.dev: shared subscription and marginal work

| Shared organization plan | Monthly charge | Included execution credits |     Concurrent runs |             Schedules |
| ------------------------ | -------------: | -------------------------: | ------------------: | --------------------: |
| Free                     |          USD 0 |                      USD 5 |                  20 |                    10 |
| Hobby                    |         USD 10 |                     USD 10 |                  50 |                   100 |
| Pro                      |         USD 50 |                     USD 50 | 200, before add-ons | 1,000, before add-ons |

| Machine           | vCPU / RAM     | USD per executing second |
| ----------------- | -------------- | -----------------------: |
| Micro             | 0.25 / 0.25 GB |                0.0000169 |
| Small 1x, default | 0.5 / 0.5 GB   |                0.0000338 |
| Small 2x          | 1 / 1 GB       |                0.0000675 |
| Medium 1x         | 1 / 2 GB       |                0.0000850 |

Every started managed run adds **USD 0.000025** invocation cost; development runs are uncharged. Paid runtime and invocation usage share the plan credit. Durable checkpointed waits and waiting for subtasks avoid executing-compute charges; ordinary network latency inside a running task still contributes to elapsed execution. [Trigger pricing](https://trigger.dev/pricing)

Calculated at Small 1x: `run cost = executing seconds × 0.0000338 + 0.000025`. Thus 1,000 ten-second runs cost **USD 0.363**, or INR 36.30 at the planning conversion, before taxes. A 120-second run costs **USD 0.004081**. These are raw marginal meters; they are not an additional subscription per Business.

For Hobby, estimate `10 + max(total organization compute and invocation cost - 10, 0)`, with other add-ons separate. Free credits are one shared organization pool. Free is not a production capacity promise: the current repo contains multiple recovery schedules, before customer saved searches. Size the actual schedule count/concurrency/retention. The selected Hobby subscription in [operating costs](operating-costs.md) should be amortized across Businesses. For conservative plan pricing below, raw tenant worker usage is charged even while credits cover it; that intentionally over-provisions the early shared-credit case.

### Vercel, Neon, storage and transactional mail

| Service                | Verified rate / allowance                                                                                                                                 | Planning treatment                                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel Pro             | USD 20/month platform fee; one deploying seat and USD 20 shared usage credit. Extra deploying seats USD 20/month.                                         | One operator deployment, not one plan per Business. Metered products/add-ons can exceed included credit. [Pro docs](https://vercel.com/docs/plans/pro-plan)                                                                                       |
| Neon Launch            | USD 0.106/CU-hour; USD 0.35/GB-month database storage; history USD 0.20/GB-month of retained changes. Free currently lists 100 CU-hours and 1 GB/project. | `0.25 CU × 730h × 0.106 = USD 19.345`; 1–5 GB DB gives USD 19.695–21.095 before history/other meters. Periodic work may prevent sleep. [Neon pricing](https://neon.com/pricing)                                                                   |
| Cloudflare R2 Standard | Shared free 10 GB-month, 1M Class A and 10M Class B/month. Excess USD 0.015/GB-month, USD 4.50/M A, USD 0.36/M B; direct egress free.                     | 100 GB-month with requests inside allowances: USD 1.35. Count document/evidence reads and writes, backups and retention; billing units round up. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)                                      |
| Resend transactional   | Free: 3,000/month, 100/day, three domains. Pro entry tier USD 20/month for 50,000; overage USD 0.90/1,000.                                                | Shared authentication, billing and operational notices only. Customer outreach/channel bills remain separate. [Pricing](https://resend.com/pricing?product=transactional), [official machine-readable price sheet](https://resend.com/pricing.md) |

A selected shared core of Vercel Pro + Trigger Hobby is **USD 30/month**, not a full operating bill. With continuously active 0.25-CU Neon/1–5 GB DB, it becomes about **USD 49.70–51.10**; adding Resend Pro makes it **USD 69.70–71.10**, before excess usage, history, tax, FX and unpriced components. These are calculated scenarios, not provider bundles or ceilings. Do not buy Resend Pro solely because a scenario includes it.

For the following business model use a **USD 75/month shared reserve**: roughly the latter core plus a small cushion, not a quote or tax-inclusive guarantee. At INR 100/USD, allocation is INR 7,500 for one Business, INR 1,500 each at five, INR 750 each at ten. Extra compute, deployments, team seats, observability, backups, domains, production OAuth verification/security assessment, support, accounting and vendor contract minimums can increase it. The operator's existing AI-plan allocation is additional if assigned to this product.

## Proposed three INR monthly plans

These are recommendations for implementation and operator publication, **not existing prices or seeded entitlements**. Use the actual paid calendar-month period. Recommended unused allowances expire at the period end, with no automatic overage charge. New spending requires an explicit supported purchase/change flow.

| Per Business, shared across authorized users                   |       Starter |        Growth |         Scale |
| -------------------------------------------------------------- | ------------: | ------------: | ------------: |
| Monthly subscription, before applicable tax                    | **INR 1,999** | **INR 4,999** | **INR 9,999** |
| Illustrative total if 18% output GST applies                   |  INR 2,358.82 |  INR 5,898.82 | INR 11,798.82 |
| Discovery resource credits/month                               |         1,200 |         4,000 |        10,000 |
| Outbound automation allowance, `provider calls`/month          |           500 |         2,000 |         5,000 |
| AI input-token planning ceiling, all paid workflows combined   |            2M |            8M |           20M |
| AI output-token planning ceiling, including reasoning/attempts |          0.5M |            2M |            5M |
| Internal monthly executing-worker estimate at Small 1x         |    30,000 sec |    90,000 sec |   180,000 sec |
| Internal monthly invocation estimate                           |         3,000 |        10,000 |        25,000 |
| Other marginal infrastructure reserve                          |      USD 1.50 |      USD 4.00 |     USD 10.00 |

All plans can expose the same core workflow—Business setup, evidence-backed discovery, approved outreach, conversations and supported booking—where the relevant integrations are actually ready. Differentiate by bounded allowances, not invented feature readiness or unlimited usage. Meta/WhatsApp charges and customer mailbox/phone subscriptions are paid separately by the Business; automation units are not prepaid channel credits or guaranteed delivered messages. A plan does not guarantee qualified leads, engagement, meetings, sales or deliverability.

### Translate discovery credits into the existing resource ledger

Recommended explicit policy, using the **same exact unit string** in offer and discovery policy: one Search reserves **8 credits**, one single-type Contents page **1 credit**, one AI evidence review **1 credit**. Keep AI token/funding controls separate. This can use existing `searchUnits`, `contentsUnits`, `reviewUnits` and Business-period reservations; it is a proposed configuration, not an already activated policy. [Discovery configuration](discovery.md), [Exa policy](exa-discovery.md), [paid allowance contract](subscription-payments.md)

Illustrative mixed monthly usage, assuming requests and reviews succeed within their other bounds:

| Example allocation, not guaranteed results         |  Starter |   Growth |    Scale |
| -------------------------------------------------- | -------: | -------: | -------: |
| Auto Search requests                               |      100 |      300 |      800 |
| Single-type Contents pages                         |      200 |      800 |    1,800 |
| Evidence reviews                                   |      200 |      800 |    1,800 |
| Credits consumed: `8 × searches + pages + reviews` |    1,200 |    4,000 |   10,000 |
| Exa cost for this example                          | USD 0.90 | USD 2.90 | USD 7.40 |

Different mixes are possible within the shared credits. These are not independent additive monthly promises. At public prices, each search credit costs at most `0.007/8`, and each Contents credit costs `0.001`; reviews consume separately budgeted AI. Therefore a conservative **Exa-only bound is USD 0.001 × all discovery credits**: USD 1.20/4.00/10.00, assuming the stated products/results/content limits and no unmetered fallback. Failed or uncertain calls still consume reservations. A retry must reserve again; it does not reset the budget.

Use per-run caps such as 120 credits, at most ten returned result candidates/search, one Contents type, bounded excerpts, explicit call/attempt/deadline limits and no hidden SDK retries. Saved schedules consume the same period allowance. The model must not turn a subscription into permission for arbitrary tool spending.

**Enforcement gap:** existing documents establish Business-scoped discovery units and outbound attempt reservations, not these proposed numeric prices, cross-workflow monthly token caps, per-Business billed worker-second/invocation limits, storage quotas or seat limits. The parent must compose matching actual configuration and enforce any new advertised caps before selling them as limits. Worker figures above are internal estimates; do not advertise raw compute as a customer entitlement. Keep financial reconciliation, cancellation and required retention/recovery available independently of a customer's exhausted acquisition pool. If exact token/compute bounding cannot be implemented now, publish only the genuinely enforced resource allowances and treat this table's other figures as internal assumptions needing observation.

### Conservative cost calculation

Planning assumptions:

- **INR 100/USD**, a deliberately rounded planning conversion dated 2026-11-10, consistent with the existing ledger; not a live FX quote. Use actual invoiced/bank FX when reconciling.
- AI at 0.40/M input + 1.60/M output, no cache discount or promotional credits. Exa at the credit worst-case above. Worker raw rates ignore included credits.
- Add **25% to the variable vendor subtotal** for retries/measurement uncertainty, provider taxes and FX friction. This is a reserve, not a validated tax calculation or guaranteed maximum. All attempts must still fit actual budgets.
- Gateway base scenario: 2% domestic + 0.99% recurring + 18% GST on both fees = **3.5282% of collected gross**. Corporate/international sensitivity: 3% + 0.99%, then fee GST = **4.7082%**. Actual contracted pricing can differ.
- Illustrative customer GST is 18%, separate from gateway fee GST. It is excluded from revenue; merchant registration, service classification, place of supply and actual output tax require approval. No input-tax-credit saving is assumed.
- Allocate shared USD 75/month across **ten paying Businesses** = INR 750 each. Add the full shared reserve at one customer; do not assume ten exist.

| Full-envelope calculation                                              |        Starter |           Growth |            Scale |
| ---------------------------------------------------------------------- | -------------: | ---------------: | ---------------: |
| AI budget, USD                                                         |          1.600 |            6.400 |           16.000 |
| Exa worst-case, USD                                                    |          1.200 |            4.000 |           10.000 |
| Worker estimate, USD                                                   |          1.089 |            3.292 |            6.709 |
| Other metered reserve, USD                                             |          1.500 |            4.000 |           10.000 |
| Variable vendor subtotal, USD                                          |          5.389 |           17.692 |           42.709 |
| Variable subtotal × 1.25 × INR 100                                     | **INR 673.63** | **INR 2,211.50** | **INR 5,338.63** |
| Domestic recurring fee including fee GST, on illustrative gross        |      INR 83.22 |       INR 208.12 |       INR 416.29 |
| Shared allocation at ten Businesses                                    |     INR 750.00 |       INR 750.00 |       INR 750.00 |
| Remainder before labor, acquisition and excluded costs                 | **INR 492.15** | **INR 1,829.38** | **INR 3,494.09** |
| Same remainder with corporate/international fee sensitivity, before FX |     INR 464.32 |     INR 1,759.77 |     INR 3,354.86 |

The last rows are conditional contribution illustrations, **not profit forecasts**. At one paying Starter Business, allocating the full INR 7,500 shared reserve produces a roughly **INR 6,257.85 shortfall** before other excluded costs. Contract minimums, support, onboarding, staff, refunds, chargebacks, statutory filings and the existing AI-plan allocation are not covered by a claimed profit margin. Measure actual workload and collection mix before increasing allowances; retain a separate global spend stop and usage alerts. Do not fund a permanent plan promise with temporary free credits.

## Razorpay: fees, restrictions and live collection

### Fees that must be confirmed on this merchant account

Razorpay's public standard gateway pricing is **2% plus GST**, with no standard setup/AMC. Its pricing explainer lists corporate/business and international cards at **3%**, and Subscriptions at **0.99% additional**. The Subscriptions product page instead shows a limited-time **0.5%** surcharge. These public claims are not an agreed NMT price. Budget the higher researched scenario pending actual commercial terms; it is not a contractual ceiling. UPI's zero bank MDR does not establish zero gateway platform fees. [Gateway pricing](https://razorpay.com/pricing/), [official fee explainer](https://razorpay.com/blog/razorpay-payment-gateway-pricing-explained/), [Subscriptions offer](https://razorpay.com/subscriptions/)

If 0.5% recurring is actually approved, corresponding 2%-base and 3%-base scenarios including fee GST are 2.95% and 4.13%. FX, bank charges, special cards, dispute costs, optional settlement features and account-specific charges remain additional. Do not use introductory zero-fee offers in plan economics. Current [90-day offer terms](https://razorpay.com/terms/90-day-free-pg-offer/) have eligibility/exclusions, continuing tax and a possible INR 199 plus tax KYC charge. No offer eligibility or fee waiver has been established for NMT.

Regular refunds have no separate standard refund charge, but the original captured-payment fees and taxes are retained. Instant refunds can cost extra. Maintain refund cash separately from revenue and distinguish refund initiation from final processing. [Refund FAQ](https://razorpay.com/docs/payments/refunds/faqs/)

### Supported product is broader than the implemented launch path

| Route                            | Current provider capability                                                                                                                                             | Lead Relay launch implication                                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domestic recurring cards         | Visa, Mastercard and RuPay, subject to bank/network support and mandate rules. Ordinary automatic debits up to INR 15,000; larger ordinary SaaS charges need AFA.       | Existing reviewed integration starts with cards. Keep **gross tax-inclusive** plan charge inside reviewed native/account limits. All three illustrated totals fit below INR 15,000.          |
| UPI AutoPay                      | INR only; current overview distinguishes mandate creation up to INR 1 lakh from ordinary frictionless debits up to INR 15,000. Higher BFSI relief is category-specific. | Do not advertise it as available: ADR 0007 defers it and the current adapter requires UPI disabled. Validate distinct mandate/change/cancellation flows first.                               |
| International subscription cards | Supported international currencies via cards; subscription FAQ says settlements in INR. International cards require separate risk/banking approval.                     | INR domestic approval does not prove international recurring approval. Existing integration's researched scope is USD/foreign-card billing and INR settlement, subject to merchant evidence. |
| eMandate                         | A separate provider-supported method, with its own limits and approval.                                                                                                 | Current integration requires it disabled; no capability inferred from generic Razorpay availability.                                                                                         |

Sources: [supported subscription payment methods, updated 2026-10-08](https://razorpay.com/docs/payments/subscriptions/supported-payment-methods), [card limits and international settlement FAQ](https://razorpay.com/docs/payments/subscriptions/faqs), [international card activation](https://razorpay.com/docs/payments/international-payments/international-debit-credit-cards), [repo account review contract](razorpay-card-billing.md).

Do not assume a plan can be changed in place for every method. Razorpay documents card-only subscription updates; UPI/eMandate need a distinct path. Domestic card changes have additional restrictions. Existing quotes/mandates must preserve agreed prices and periods. Check the current [subscription update guide](https://razorpay.com/docs/payments/subscriptions/update) before implementing changes; do not rely on the generic API's existence as approval.

### Public website and customer disclosures

Razorpay asks for a live website and reviewable links to **About, Contact, Pricing, Terms, Privacy and Cancellation/Refund** pages, plus a sample invoice and review credentials if payment requires login. Its setup guidance also calls for Shipping policy; for a software subscription publish a truthful **Service delivery / no physical shipping** policy explaining activation and dependencies. The international-card guide expressly requires Shipping, Terms, Privacy and Refund/Cancellation pages. [Business website review](https://razorpay.com/docs/payments/dashboard/account-settings/business-website-details), [international prerequisites](https://razorpay.com/docs/payments/international-payments/international-debit-credit-cards)

Recommended content the parent can prepare now:

- **Identity/contact:** distinguish the Lead Relay product from its legal seller; show verified legal name, registered/principal address, actual support email and phone, grievance contact and applicable identifiers. Put real facts in invoices and structured data; leave unverified facts out of public claims.
- **Pricing:** each plan's currency, amount, applicable tax and final payable total, calendar-month renewal, shared Business allowances, counting/reset rules, separate channel bills, available markets and purchase prerequisites. Explain that evidence-backed prospects are not guaranteed qualified leads.
- **Recurring purchase:** clear affirmative agreement to recurring billing, first amount, subsequent amount/frequency, mandate/cycle validity, billing date/calendar behavior, any pilot conversion and cancellation route. Keep marketing consent separate and optional.
- **Cancellation/refunds:** obvious in-app cancellation, effective date, what stays usable until paid-through, treatment of pending requests, no future renewal after confirmed cancellation, refund eligibility/process/contact/timeframes and applicable statutory rights. Do not equate cancellation with a refund or use a universal “no refunds under any circumstances” clause.
- **Service delivery:** account access after authoritative captured-payment confirmation; paid features after required integration setup; provider delays/failures and support route. No invented instant-onboarding or uptime SLA.
- **Privacy:** product-specific data categories/purposes, mailbox/calendar scopes, historical-import consent, AI/search/payment subprocessors and transfers, retention/deletion and lawful financial retention, rights/contact, security and cookie/analytics disclosures reflecting implementation.

These are recommended product terms requiring merchant facts and appropriate review; a Razorpay-generated policy page is not proof that the contents match this service or its legal obligations.

### Subscription webhook events and payment authority

Enable the supported native subscription event family: `subscription.authenticated`, `.activated`, `.charged`, `.pending`, `.halted`, `.cancelled`, `.completed`, `.updated`, `.paused` and `.resumed`. In particular, **activated is a lifecycle event, not proof of a captured paid month**. Reactivation after pending/halted does not mean previously generated unpaid invoices were charged. [Official event definitions](https://razorpay.com/docs/webhooks/subscriptions)

Use the deployed HTTPS `https://leadrelay.nmtsolutions.in/api/payment-events`, actual live/test merchant binding and server-only webhook secrets. Verify HMAC-SHA256 on the original raw request bytes, retain event identity for deduplication, tolerate duplicate/out-of-order delivery and retain old secrets for retried old events. Confirm the actual endpoint is reachable and not blocked by deployment protection. [Webhook validation](https://razorpay.com/docs/webhooks/validate-test), [repo receipt/reconciliation contract](razorpay-card-billing.md)

The current app grants paid scope through independently reconciled captured payment, exact paid native invoice/amount/currency/bindings and immutable `subscription_period`. Browser callbacks, authorization tokens and signed lifecycle hints are not substitutes. Payment/invoice/refund/dispute events should be enabled only for their implemented routes and consumers; do not assume every webhook family can be sent to this subscription endpoint. Recovery must continue without the purchaser's browser session. [Payment recovery](subscription-payments.md)

For merchant account activation, do not confuse subscription activation events with account-onboarding webhooks. Public APIs or partner account events do not establish that NMT's account has passed KYC or international recurring review.

### Merchant activation sequence

1. The authorized company representative completes or verifies the Razorpay merchant application using the actual entity, business activity/category, contact, PAN/incorporation details and settlement bank account. CKYC can retrieve existing identity records; absent/failed CKYC can require documents and Video KYC. Do not create a new merchant account if the intended one already exists. [Account setup](https://razorpay.com/docs/payments/set-up)
2. Supply the entity-specific documents requested in the application. Current limited-company guidance includes incorporation/CIN, MOA/AOA, Business PAN, bank details, authorized signatory identity/authority and beneficial-owner declarations. Treat these as official private uploads, not repository content. Confirm the appropriate OPC category with the actual application. [KYC document guide](https://razorpay.com/docs/payments/business-types-kyc-documents)
3. Submit `https://leadrelay.nmtsolutions.in` and the actual policy/pricing/contact pages and sample invoice. Adding a product subdomain to an existing merchant requires the provider's website review where applicable. Confirm the actual review outcome. [Website settings](https://razorpay.com/docs/payments/dashboard/account-settings/business-website-details)
4. Confirm activation and live Subscriptions/card settings. For the current adapter, disable both UPI and eMandate in Subscriptions settings. Request international cards separately only for approved target countries/currencies, service/purpose code and terms. A successful test payment proves neither live activation nor bank settlement. [International activation](https://razorpay.com/docs/payments/international-payments/international-debit-credit-cards)
5. Map real immutable native monthly plans to app offers, currency, exact gross payable amount, quantity one, approved cycle count and calendar behavior. Configure live API/webhook material securely, record account evidence and deploy the same reviewed settings to web and workers. Complete authorized sandbox then controlled live acceptance and bank reconciliation; no approval or test has been performed by this research.

## India legal and regulatory position on the checked date

### DPDP is staged; do not claim all substantive duties are already in force

The notified Act commencement order **G.S.R. 843(E)** brings definitions, Board/administrative provisions and specified sections into force first; section 6(9) and section 27(1)(d) follow after one year; principal processing/consent/rights/obligation provisions and section 44(2) follow after eighteen months. The Gazette is dated 2025-11-13 and the official portal records publication on 2025-11-14. Thus on **2026-11-10**, both the November 2026 one-year stage and May 2027 substantive stage are still ahead. Use the actual Gazette-publication anniversary for legal deadlines; do not derive it from a press-release upload timestamp. [Official commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf), [MeitY publication index](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025%3B)

The final **G.S.R. 846(E) Rules** likewise stage rules 1, 2, 17–21 immediately, rule 4 after one year, and rules 3, 5–16, 22–23 after eighteen months. Build now for clear itemized notices, accessible withdrawal/rights channels, security, processor contracts, retention/erasure and breach handling. Do not claim registration as a statutory Consent Manager merely because the app stores customer approvals. [Final Rules](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)

The Act's public-data exclusion is narrower than “anything on the internet”: section 3(c)(ii) concerns data made publicly available by its Data Principal or someone legally obliged to publish it. It does not automatically cover scraped personal contact details or private mailbox content. Controller/fiduciary versus processor roles differ between NMT's own account/billing processing and processing selected customer mail. Obtain role-specific review. [DPDP Act sections 3, 6, 8 and 16](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf)

The eighteen-month delay also includes DPDP section 44(2), which amends the IT Act. Do not assume the preceding IT Act/SPDI framework has already disappeared. Assess current privacy-policy, sensitive-data, security and transfer obligations under the [official IT Act rules collection](https://www.meity.gov.in/documents/act-and-policies/rules-for-information-technology-act-2000-YDO5AjMtQWa); historical direct MeitY SPDI PDF/press-note links returned 404 during retrieval. That limitation prevents this note from presenting those old links as a newly verified consolidated legal text. Counsel should verify the operative text and applicable security/incident-reporting requirements for the actual service.

### Consumers, cancellation and recurring mandates

Lead Relay targets Business buyers. Consumer-law applicability depends on actual purchaser/purpose and statutory definitions, not a “B2B” checkbox alone. Where Indian consumer e-commerce rules apply, they require prominent entity/address/contact information, grievance arrangements, acknowledgment within **48 hours** and redress within **one month**, affirmative purchase consent and specified protections around cancellation charges/refunds. Do not apply marketplace-only duties mechanically to this direct SaaS seller. [Consumer Protection (E-Commerce) Rules, 2020, particularly rules 4 and 7](https://consumeraffairs.nic.in/sites/default/files/E%20commerce%20rules_0.pdf)

The CCPA's 2023 dark-pattern guidelines identify hiding cancellation, making it complex, and ambiguous cancellation instructions as subscription traps; SaaS billing and drip pricing are also addressed. Recommended implementation: cancellation from the billing screen, clear price/renewal terms and an accessible support fallback. No compulsory call, retention questionnaire, unrelated app or repeated persuasion should obstruct cancellation. [Official-hosted guidelines](https://consumeraffairs.nic.in/sites/default/files/file-uploads/latestnews/central-consumer-protection-authority-dark-patterns-guidelines-watermark-1565354.pdf#page=1)

Use the **current RBI Digital Payments – E-mandate Framework, 2026**, dated 2026-04-21, rather than treating the original 2019 circular as the latest law. It consolidates/repeals prior listed directions, covers payment-system participants processing recurring domestic/cross-border card/PPI/UPI transactions, and requires AFA registration/first transaction, specified validity, issuer withdrawal/modification facilities, pre-debit notification at least **24 hours** before debit, transaction/mandate opt-out and post-debit notice. Ordinary no-AFA recurring threshold remains **INR 15,000**; INR 1 lakh relief is for named financial categories. Acquirers must ensure onboarded merchant compliance. [RBI 2026 framework](https://www.rbi.org.in/scripts/FS_Notification.aspx?Id=13374&Mode=0&fn=9)

Razorpay/banks implement the mandate/issuer mechanisms; Lead Relay must accurately disclose recurring terms, honor provider cancellation/revocation and avoid future collection after confirmed cancellation. The provider FAQ's older statement about international-card exemptions is not a blanket exemption from the 2026 framework; verify the actual foreign issuer/acquirer route with Razorpay. In-app cancellation and bank mandate revocation are related but distinct operations. Native cancellation supports immediate or cycle-end behavior and cancelled subscriptions cannot simply be restarted. Preserve eligible paid-through access separately from refund handling. [Cancel API](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription), [existing lifecycle contract](subscription-lifecycle.md)

### Tax, overseas sales, data and outreach limitations

- **Indian GST:** get a CA's actual registration/status, service/SAC classification, output rate, place-of-supply and invoice/credit-note treatment. The illustrative 18% plan-tax assumption is not proof NMT may collect GST or that every sale has that rate. Export-of-service treatment requires all statutory conditions; foreign currency, a foreign card or INR settlement alone is insufficient. Eligible payment can include INR where RBI permits, as the [IGST amendment](https://gstcouncil.gov.in/sites/default/files/2024-03/annexure-5-igst-amendment-act_2018_1.pdf) confirms. Verify the consolidated [IGST Act, section 2(6)](https://www.indiacode.nic.in/bitstream/123456789/2251/1/A201713.pdf) and actual remittance evidence; that consolidated PDF timed out in direct retrieval, so it is not represented here as a successful fresh fetch. Review LUT, foreign-remittance/purpose-code evidence, applicable software-export reporting, imported-service/RCM and withholding obligations with the CA/authorized dealer; no universal exemption is asserted.
- **Overseas indirect taxes:** Razorpay collection is not foreign tax registration/remittance. Establish customer country and B2B/B2C status, tax identifiers/evidence, thresholds, reverse charge and registration/reporting by approved destination. EU non-Union OSS can report qualifying services to non-taxable persons; it is optional simplification, not a worldwide exemption. UK and US obligations need separate jurisdiction review. [European Commission OSS](https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en)
- **Data transfers:** documented subprocessors, regions, DPAs, retention and appropriate cross-border safeguards are needed for the actual data/markets. EU SCCs can be relevant and require the applicable module and transfer assessment; a provider's “GDPR” marketing claim is not sufficient. [European Commission SCC guidance](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/new-standard-contractual-clauses-questions-and-answers-overview_en) was available through official search excerpts; direct retrieval returned HTTP 429. No India-only processing claim is established.
- **Discovery is not outreach authorization:** preserve source attribution, minimize personal data, and gate sending by destination, recipient class, permission, sender identity and suppression. UK PECR distinguishes corporate subscribers from sole traders/some partnerships; personal-data processing still needs a lawful basis and transparency. [ICO B2B guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/) was available in official search; direct retrieval returned HTTP 403 and the guidance itself notes review after UK law changes. Do not treat it as approval for a particular campaign.
- **United States email:** CAN-SPAM includes B2B commercial email and requires truthful headers/subjects, applicable ad identification, postal address, an opt-out and timely honoring of it. Provider and sender responsibilities are not removed by outsourcing. [FTC compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- **Other channels/markets:** India commercial telecom calling/SMS rules and consent/DLT requirements, Meta opt-in/template rules and each destination's anti-spam/privacy regime require channel-specific validation. A worldwide discovery plan is not permission for worldwide automated outreach. A current [TRAI consent/UCC publication](https://www.trai.gov.in/sites/default/files/2025-12/PR_No.150of2025.pdf) illustrates continuing telecom controls; it is not a legal basis for email. Keep unsupported or unreviewed destinations/channels unavailable.

These questions require the merchant's actual legal facts and, where applicable, CA/CS/legal or authorized-dealer review. No universal legal compliance, GST registration, incorporation verification, export eligibility or regulatory approval is asserted.

## Verifiable public NMT facts

Read-only HTTPS retrieval succeeded for the company site after general web retrieval failed. Pages reviewed: [home](https://www.nmtsolutions.in/), [About](https://www.nmtsolutions.in/about-us), [Privacy](https://www.nmtsolutions.in/privacy-policy), [Terms](https://www.nmtsolutions.in/terms-and-conditions), [Support](https://www.nmtsolutions.in/customer-support), and the [Lead Relay home](https://leadrelay.nmtsolutions.in).

| Fact                                                                                             | What was verifiable on 2026-11-10                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public company brand                                                                             | NMT Solutions; web/mobile, IoT and business automation services.                                                                                                                                              |
| Public email                                                                                     | **wafa.khan@nmtsolutions.in**, repeated on home, support and policy pages. This establishes publication, not a designated statutory grievance officer.                                                        |
| Product/operator wording                                                                         | Lead Relay home describes the product as by NMT Solutions; footer uses “NMT Solutions OPC PVT LTD”. The user supplies that legal-seller name. It is not independently verified against incorporation records. |
| Registered/principal address, support phone, CIN, GSTIN                                          | **Not verifiable on the reviewed public pages.** Do not infer from domain ownership, a similarly named directory company or the email recipient.                                                              |
| Incorporation, directors/signatory, bank ownership, GST registration, Razorpay merchant approval | **Not verified.** Require merchant records/private account evidence.                                                                                                                                          |

The corporate Privacy and Terms pages state March 2023 update dates and are generic. They do not establish complete Lead Relay AI/mailbox/subscription disclosures or current cancellation/refund/service-delivery terms. The Terms refer readers to a refund policy; this research did not verify a complete product-specific refund policy there. Use the published email as an evidenced starting contact, then have the operator designate the actual support/privacy/grievance route. Do not invent phone/address/tax/legal facts for SEO, policies or payment onboarding.

## Official Trigger.dev skills and deployment handoff

The official [Trigger skills documentation](https://trigger.dev/docs/skills) names `trigger-authoring-tasks` and `trigger-cost-savings`. The installed **`@trigger.dev/sdk` 4.8.3** already contains both; this research read them directly:

- [Official task skill in the installed SDK](../node_modules/@trigger.dev/sdk/skills/trigger-authoring-tasks/SKILL.md).
- [Official cost skill in the installed SDK](../node_modules/@trigger.dev/sdk/skills/trigger-cost-savings/SKILL.md), plus its canonical [reduce-spend guide](../node_modules/@trigger.dev/sdk/docs/how-to-reduce-your-spend.mdx).

These are provider-owned, version-pinned SDK skills; the older globally installed `trigger-tasks` name is not evidence of using the current named official skill. No skill installation was necessary for reading these references and no instruction files were modified. The official installer is `npx trigger.dev@latest skills`; the parent can add discoverable pointers if needed.

Apply the skills' guidance when implementing: use `@trigger.dev/sdk`, bounded task duration and attempts, appropriate machines, durable waits, safe idempotency and actual usage observations. Do not replace payment/domain idempotency with a short-lived task key or replay an uncertain financial operation. Existing `trigger.config.ts` uses `TRIGGER_PROJECT_REF`, `./src/trigger` and `maxDuration: 300`.

The parent must **actually deploy** the production tasks; a Vercel deployment alone does not do so. The official flow is CLI authentication and `trigger.dev deploy` (production by default, subject to credential environment); `--env` selects another environment, and a dry run does not deploy. Prefer the project-compatible pinned CLI, configure real project/production environment variables, deploy and retain the successful deployment/version plus registered task/schedule evidence. Confirm payment reconciliation and cancellation recovery, discovery/saved schedules, notification, invoice/refund/tax and other configured recovery jobs run against the same production merchant/DB/settings as the app. [Official deployment guide](https://trigger.dev/docs/deployment/overview)

This research did not authenticate, inspect an account, deploy, trigger a task or observe a live worker. If deployment access is missing, the unavoidable operator action is the existing account's authentication/project access; code preparation and deploy verification remain the parent's work.

## Parent-owned onboarding, production and SEO acceptance

Prepare these concrete flows before asking for external setup facts:

1. Public plan comparison and policy/contact pages lead to signup, Business creation/identity/geography, plan selection, billing/tax details, exact initial/renewal review and explicit recurring authorization. Explain prerequisite integrations before payment; preserve a useful setup state after payment.
2. Onboard Google/Microsoft email and calendar with distinct grants, optional bounded historical import, sender/reply readiness and first-outreach approval. Do not advertise production OAuth or WhatsApp onboarding as complete without actual provider approval/capability evidence.
3. Show captured paid-through status, shared allowance usage and near-limit/exhaustion behavior. Expose billing history/invoices, payment recovery and cancellation from the customer flow. Show unconfirmed cancellation honestly and provide an actionable support route.
4. Configure production domain/TLS, canonical origin/auth callbacks, server-only credentials, restricted DB/RLS, storage, transactional sender authentication and all reviewed provider/tax/lifecycle settings. Keep web and Trigger settings consistent. Apply the existing schema/security path before rollout; perform controlled end-to-end payment, renewal/reconciliation, invoice, limit and cancellation checks with actual accepted evidence.
5. Give public product/pricing/help/policy pages stable canonical URLs, useful titles/descriptions and a sitemap. Use verified Organization facts only; do not fabricate reviews, prices, legal address or approval claims. Private Business/billing pages require authorization and appropriate indexing controls. `robots.txt` is not access control and does not reliably prevent indexing of a URL; use authentication and appropriate noindex behavior. [Google robots guidance](https://developers.google.com/search/docs/crawling-indexing/robots/intro), [sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview)

No operator should be asked to write code, invent account-review evidence or manually do work already possible with authorized deployment access. Reserve the final external requests for facts, private verification or access only the operator/provider can supply.

## Exact operator-supplied facts and configuration checklist

1. **Seller identity:** registered legal name/spelling, CIN, registered/principal address, support phone, GST registration status/GSTIN if any, and actual signatory authority. Supply evidence privately; approve public support/privacy/grievance contacts, including whether the published email is the intended route.
2. **Approved commercial/tax terms:** accept or adjust the three prices/allowances, available markets and currencies, tax treatment/SAC and invoice particulars, refund eligibility/timeframes, cancellation timing/paid-through policy, grace policy, retention and any pilot renewal terms. Obtain CA/CS/legal review for facts outside engineering's authority.
3. **Razorpay merchant activation:** intended existing merchant identity/account, completed company/bank/owner/signatory KYC or pending requested CKYC/Video KYC steps, website review outcome and actual live Subscriptions/card activation. Complete private verification in Razorpay; do not send identity documents or secrets into this file.
4. **Razorpay commercial/capability evidence:** actual domestic/corporate/recurring fee and fee-GST terms, FX/settlement/currency/limits, card-only method settings, native plan IDs/gross amounts/cycle count/calendar and cancellation/update capability. For overseas sales, explicit international recurring approval and approved purpose/country/currency evidence.
5. **Secure configuration access:** live payment API material and rotating webhook secret through the deployment secret store; complete attributable `RAZORPAY_ACCOUNT_REVIEW` and `SUBSCRIPTION_LIFECYCLE_POLICY` with real retained evidence. Same approved values must reach web and workers; no credentials in Markdown, tickets or public review links.
6. **Exa procurement/access:** executed order/MSA and data/source-rights evidence matching `EXA_ACTIVATION_JSON`, actual rates/minimum/payment terms/limits, funded account and API secret in the secret store. Do not substitute public PAYG terms or fabricated completion references for the repo's executed-order gate.
7. **Production access only where absent:** correct Trigger organization/project and deploy authentication, Vercel/domain DNS authority, Neon/storage and transactional sender access, funded OpenAI project/model access and explicit global budgets. Parent performs configuration, official-skill use, task deployment and verification once access exists.
8. **Only for enabled external integrations/markets:** required Google/Microsoft production consent/verification, Meta business/channel onboarding, authorized-dealer/export/tax evidence and foreign-country privacy/outreach approvals. Request the provider's exact outstanding step rather than asserting a general approval or blocking unrelated supported domestic functionality.
