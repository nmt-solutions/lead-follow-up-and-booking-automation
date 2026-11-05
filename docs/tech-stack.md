# Tech stack and services

Working decision record for the stack interview. The product scope remains full inquiry/sales automation (A) plus context-bound prospect discovery (B).

## Confirmed constraints

- Prefer managed services for the first pilots; keep business logic behind provider adapters.
- Fixed infrastructure planning ceiling: INR 10,000 per month. Separately cap and meter variable AI, search, email, and WhatsApp usage. This ceiling is a spending constraint, not a forecast or provider quote.
- Initial capacity target: 1-10 paying businesses, using queued work and bounded discovery concurrency. Scale from measured workloads.
- Start with one primary data region. Check contractual country-specific residency requirements during customer onboarding; discovery geography is independent of storage location.
- Use TypeScript across the web application, API, and discovery workers, with shared business modules and a separate asynchronous execution boundary. Introduce Python only for a demonstrated requirement.
- Preserve the agreed primary application-level testing boundary with deterministic external adapters and a controlled clock.

## Confirmed service choices

- Web application and HTTP/API layer: Next.js App Router with React. Keep business logic and asynchronous workers independent of the framework.
- TypeScript implementation: Effect for the discovery workflow only; conventional Next.js handlers and other workflows follow [the corrected coding guide](ts-coding-guide.md). Keep explicit Effect host adapters and retain Trigger.dev for durable execution. [ADR 0010](adr/0010-use-effect-for-discovery-workflow.md), [integration details](typescript-effect-options.md).
- Website UI: Tailwind CSS and shadcn/ui throughout. Apply both `apple-design` and `apple-design-diwu` whenever writing or changing frontend code, and review the changed flow with both skills. [Frontend rules](agents/frontend.md).
- PostgreSQL: Neon. Budget from the selected plan's actual compute, storage, recovery, and transfer usage; plan limits and spending controls are being verified.
- Application authentication: app-hosted Better Auth inside the Next.js deployment, using Neon PostgreSQL. Enable RBAC for the current Business scope; add only plugins needed by approved requirements. Defer enterprise SSO/SCIM and other optional plugins.
- Web hosting: Vercel Pro for the Next.js application and HTTP/API layer; asynchronous execution remains on Trigger.dev.
- Primary core region: US East/Virginia for Neon, the Vercel backend, and Trigger workers where supported. Configure execution locations deliberately; provider control-plane/logging exceptions and customer residency requirements still need review.
- Database tooling: Drizzle ORM, Drizzle Kit, and node-postgres (`pg`), sharing schema/migrations across the application and workers. Use pooled runtime and direct migration connections, with interactive transactions for protected work.
- Transactional email: Resend for authentication and platform notifications. Start on its free band only if the pilot's daily/monthly volumes fit; account eligibility and permitted invitation use are checked before activation. Keep customer prospecting off this stream.
- Customer mailbox synchronization: native Gmail API and Microsoft Graph (Q36), with application-owned OAuth applications, encrypted credential lifecycle, refresh/reconnect/revoke handling, synchronization and reconciliation. Keep Business/mailbox grants separate from application login, honor selected Mailbox scope/history opt-in, and budget production verification/security assessments explicitly. Nylas/Aurinko or another broker is not selected.
- WhatsApp: direct Meta WhatsApp Cloud API (Q37), with customer-owned accounts/numbers and customer-paid Meta messaging charges. Our subscription covers the automation service; disclose Meta charges separately and do not include them twice in our subscription or operator spend. Tech Provider approval, supported onboarding and coexistence eligibility remain production inputs. No paid BSP is selected.
- Web search/retrieval: Exa Search + Contents is finalized under the MSA/executed-order route, behind a model-independent adapter. Use Auto for semantic discovery, Lite for suitable focused lookups and Contents on shortlisted URLs. The order must explicitly cover our retained lead/evidence records, customer display/export, cancellation retention and actual data/commercial terms; it is not yet signed and no live usage is activated. [ADR 0009](adr/0009-use-exa-search-and-contents-under-msa.md).
- Monitoring: provider-native logs plus application-owned audit, error/health records and budget alerts (Q39). No separate observability subscription initially; respect standard retention/usage limits and redact credentials/private payloads from diagnostic records.
- Appointment calendars: native Google Calendar API and Microsoft Graph calendar APIs (Q40), with calendar grants separate from mail, customer-owned calendars and app-owned availability/booking rules. Confirm an appointment only after authoritative event creation and persistence/reconciliation; RFQ workflows remain native. No separate scheduling SaaS is selected.
- AI integration: Vercel AI SDK through Vercel AI Gateway, initially using the operator's OpenAI API organization/key and the eligible API-credit benefit from their existing ChatGPT Pro USD 100/month plan. The grant must be activated for the linked API organization; ChatGPT session credentials are not the application integration. Manage approved discovery/extraction/drafting task profiles centrally, checking capabilities, output quality, schemas, and cost before model changes. Initial models are still open.
- Durable background execution: Trigger.dev Cloud, initially the lowest suitable paid tier. Research, schedules, follow-ups, retries, and concurrency execute independently of the web host; application-level idempotency and authorization remain required.
- Private file storage: Cloudflare R2 Standard, private buckets and authorized short-lived signed access, with a United States jurisdiction restriction. This does not promise Virginia placement. UploadThing, Vercel Blob, and S3 are alternatives researched but not selected.
- Subscription billing: direct selling through Razorpay, with our business as the seller. Implement subscription billing and tax management in the application: billing profiles, tax rules/evidence, invoices and credit notes, usage/reach entitlements, refunds/disputes, tax obligations/reports/filing and remittance records, and settlement reconciliation. Start with recurring cards for INR/USD; UPI AutoPay follows validation of its separate upgrade/new-mandate flow. Cashfree remains a researched alternative if approval or terms are unsuitable; Paddle is no longer selected.
- Merchant planning base: an India-based operating business/bank account serving international customers. This is separate from customer geography and infrastructure location.

Application authentication remains separate from authorization to read/send a customer's Gmail or Microsoft mailbox.

## Tenant data and budget governance

- Initial Businesses share one Neon production database, with Business-scoped records, server-side authorization, and tested database row policies. Application and worker runtime roles must not silently bypass those policies.
- Initial Business roles are Owner, Admin, and Salesperson. Owner/Admin manage billing, integrations, and commercial permissions; Salespeople work within their Business and granted capabilities. Platform Operator access is separate.
- Implement a provider-wide budget alert mechanism in the application. Keep this separate from the existing per-run Discovery budgets and approval for extra spend.
- Separate operator-paid costs from customer-paid channel charges. Meta messaging is paid directly by the Business under the selected route; show estimated/observed customer usage with honest source/latency labels and no invented dollar cap or bundled Meta credit. Our automation/AI limits and permissions still apply.
- Show provider-wide spend and a month-end forecast, separating fixed infrastructure, database/worker usage, and AI/search/messaging costs. Support configurable global/category monthly budgets with default alerts at 80%, 90%, and 100%. Provider dollar alerts alone are not the application mechanism.
- Owners/admins who connect mailboxes, manage billing, or grant commercial authority must use MFA before privileged production access. Add the necessary MFA support when implementing that requirement; do not preload unrelated plugins.
- Check MFA enforcement on every enabled privileged sign-in path before production; the presence of a plugin alone is not evidence that all such paths are protected.

## Authentication comparison

The comparison is documented in [auth-options.md](auth-options.md). The selected option is app-hosted Better Auth, accepting application ownership of auth configuration, updates, email delivery, rate limits, and migrations. It can run within the existing managed Next.js deployment using Neon for its data.

Enterprise SSO/SCIM is deferred until required. MFA for privileged owners/admins is a launch requirement; optional plugin adoption remains incremental.

## User-initiated email handoff

- Prepare a recipient/subject/body draft for the user to open in their email client or download, and let the user explicitly send it from their own selected account.
- Use a standards-based email-client handoff and copyable content as the broad compatibility path. Downloadable email files and provider-specific compose links need client-specific validation; an `.eml` file is not universally an editable outgoing draft.
- The client/user selects the sending account. A `mailto:` action cannot force the intended From account, include attachments portably, or report that Send was pressed.
- Distinguish preparation/handoff from sending evidence using Prepared, User-marked sent, Sent-folder observed, and Reply observed. A Sent-folder observation is not proof of transport or delivery; do not infer sending from a click or a disappearing draft.
- Show matched messages and replies in the application's conversation view only when an authorized, functioning mailbox synchronization route supplies them. Forwarded/BCC copies and manual reports provide narrower evidence and must not masquerade as complete mailbox synchronization.
- Verify sender selection, download formats, and tracking compatibility before promising one-click behavior for a client. The handoff does not itself remove mailbox-data/API approval requirements or establish recipient/provider permission.
- Automated follow-ups remain subject to the applicable channel and recipient eligibility, current opportunity state, and approved sequence.

## AI routing and private files

- Use the selected Vercel AI Gateway route initially with operator-owned BYOK credentials; do not assume this enables each subscribing Business to supply its own keys. Central task profiles, a restricted model/provider list, schema/capability checks, and bounded fallback are confirmed. Model replacement still requires testing the tasks it will perform.
- AI Gateway consolidates routing, while BYOK inference is billed by the underlying provider. Upstream data policies and actual inference providers still matter. A preferred provider order is not a hard restriction; an explicit provider allowlist is needed where routing must be limited. Gateway's own spend budget does not include BYOK provider spend, so application budget accounting must include both.
- Account for Gateway's purchased-credit requirement separately from recurring BYOK inference charges. A credit deposit is prepaid cash, not a monthly subscription or an additional expense when the same credit is later consumed. Failed BYOK requests automatically retry with Gateway system credentials; a provider allowlist does not disable this. The operator approved this fallback within a small explicitly budgeted allowance (Q32); the numeric allowance remains to be set before activation.
- ChatGPT Pro's USD 100 tier currently offers USD 100/month of eligible OpenAI API credits after activation and eligibility checks. The first grant is prorated; credits expire each subscription billing cycle and do not roll over. Treat the existing USD 100 plan cash cost, API usage/grants, and Gateway fallback charges as distinct ledger items. API charges above available credits require separately funded API balance; Gateway system-key calls do not use the operator's OpenAI grant.
- Keep source evidence as permitted metadata/links by default and mailbox attachments as references unless intentionally retained. Use private object storage for Business uploads and artifacts that must be retained.
- R2 Standard with a United States jurisdiction restriction is selected, accepting that this is not a Virginia-region guarantee. The application owns tenant authorization, file rules, quotas, ownership metadata, upload completion, and retention/deletion. The free storage/request allowance is account-wide, not a new allowance for each Business.

## Customer-paid WhatsApp and conditional search

- [ADR 0008](adr/0008-use-customer-billed-meta-cloud-api.md) records Meta Cloud API with each Business's own payment method/account. Quotes and billing UI distinguish our subscription/automation allowances from Meta's separate message bill; carrier fees are not promised as included in our allowance. A consolidated platform-paid channel arrangement would be a separate decision.
- Complete the supported Tech Provider business verification/App Review and account/number onboarding before production. Permission/template/window, opt-out, takeover and unsupported-coexistence handling remain application rules regardless of who pays Meta.
- Exa Search + Contents under an executed MSA/order is the selected route, replacing the unresolved generic candidate. Keep retained facts/evidence, display/export and cancellation retention within the explicit order scope. Our SaaS is the Customer Product; end users receive the app's derived records, not API credentials. The completed agreement and actual price are still required before production. [Decision and alternatives](search-provider-decision.md), [prepared order scope](provider-requests/exa-order-scope.md).
- Public PAYG benchmarks are USD 4/1,000 Lite or USD 7/1,000 Auto searches and USD 1/1,000 Contents pages per content type. They are not an MSA quote or proof of no enterprise minimum. Bound requests/results/content types/retries per run, request only needed content, and do not initially enable Exa's Agent/Answer/Websets/Connect/Monitors or paid contact-enrichment products. See [operating-costs.md](operating-costs.md).
- Use built-in provider logs and app-owned run/error/health/audit records with alerts and recovery views. Security-sensitive operational records and customer-visible audit records have different access purposes; their exact retention is an implementation/launch input. No paid tracing, log warehouse or error SaaS is selected.

## Native appointment calendars

- Use Google Calendar free/busy and event APIs or Microsoft Graph calendar APIs with separately authorized calendar access. Mailbox grants do not establish calendar permission. Preserve Business/calendar ownership, revoke/reconnect behavior and audit.
- Our app manages working hours, time zones, duration/buffers, candidate slots, holds/locks, idempotent booking requests and last-moment availability checks. Persist the authoritative provider event ID before confirmation and reconcile ambiguous failures. Local locks coordinate our own bookings; external calendar edits can still race and need conflict handling.
- Microsoft's `getSchedule` supports work/school accounts, not personal Microsoft accounts. Personal Outlook availability needs a supported calendar-view/event-read path and app-derived busy periods; validate the actual account path before presenting it as ready. RFQ-only goals do not require a calendar connection.
- Native APIs avoid selecting a scheduling SaaS subscription, not all usage/license costs. Google quota/pricing and Microsoft account/license limits must be checked at activation; exact booking limits and provider payloads are implementation inputs. See [service-research.md](service-research.md).

## Subscription billing model

- Direct selling replaces the previous Paddle/Merchant of Record decision. Our business issues the subscription sale and owns its tax, invoice, refund/dispute and accounting obligations. [ADR 0006](adr/0006-sell-directly-with-app-owned-billing-and-tax.md) supersedes ADR 0005.
- Initial billing currencies are INR for Indian Businesses and USD for international Businesses (Q33 confirmed); other billing currencies come later. Use confirmed billing-country details rather than discovery geography or browser location. Actual price amounts remain open, and the ledger's INR/USD planning conversion is not a customer price-conversion rule.
- Razorpay is selected (Q34). Recurring cards are the initial methods (Q35); UPI AutoPay is deferred until its plan-change/mandate handling is validated. Domestic-card subscriptions still have method-specific update restrictions, so cards-first does not mean every update can use native proration. Preserve approved, confirmed upgrade charges and renewal-time downgrades through supported flows. [ADR 0007](adr/0007-use-razorpay-for-direct-subscriptions.md).
- Build a billing/tax module for our platform's subscription sales. Manage Business billing profiles, tax identifiers/evidence, versioned jurisdiction rules/registrations and effective dates, calculations and reviewed exception handling, frozen invoice tax snapshots, numbered invoices, credit notes, refund/dispute records, and auditable reconciliation.
- Manage tax obligations, reporting periods, due dates, filing/remittance status, supporting documents and approvals inside the app. Generate liability reports and accounting/filing exports. Record authoritative filing/payment confirmations; automated government filing or tax-payment integrations depend on an explicitly supported jurisdiction/adapter rather than an assumed universal API.
- Use gateway-hosted checkout and supported recurring-payment/mandate flows with signed durable webhooks, deduplication, out-of-order handling and reconciliation. Our app controls subscription state, paid-through/grace rules, approved prorated upgrades, renewal-time downgrades, and reach/usage entitlements. A checkout redirect alone cannot grant paid access.
- Product acceptance, merchant verification, supported countries/currencies/payment methods, actual fees and legal tax-rule configuration remain inputs before live billing. Unknown tax treatment is routed to review; geography or a Business checkbox cannot silently imply zero tax.
- Preserve tax-rule approvals and transaction history when rates, customer details, registration status or plans change. Limit platform-wide tax configuration/filing actions to authorized platform operators; Business Owner/Admin access remains scoped to their own billing records.
- Detailed scope is in [billing-and-tax.md](billing-and-tax.md); current pricing research remains in [service-research.md](service-research.md).
- Gateway comparison is in [payment-gateways.md](payment-gateways.md). Razorpay is selected; Cashfree is the researched alternative. Stripe/PayPal are comparison research, not additional selected integrations. Exact recurring surcharge, international activation and FX terms remain to be confirmed before live use.

## Running operational cost estimate

Maintain [operating-costs.md](operating-costs.md) throughout service selection. For each added or changed service, record its recurring commitment, expected metered spend under explicit workload assumptions, included/shared credits, transaction fees, one-time or prepaid cash requirements, and the marginal change from the previous selection. Do not present an unpriced service as zero-cost or treat a provider credit as an additional allowance for every Business.

Keep the INR 10,000 fixed-infrastructure planning ceiling separate from AI/search/messaging consumption and payment fees. Show incomplete estimates as a priced core plus named unpriced components, with a dated exchange-rate assumption for INR planning. No service account, paid tier, credit purchase, or deployment is activated by this selection record.

## Verified plan facts

Checked against official sources on 2026-11-05. These are plan facts, not an all-in cost forecast.

- Neon Launch has no base fee or monthly minimum. Its current compute and storage meters are USD 0.106/CU-hour and USD 0.35/GB-month. A continuously active 0.25-CU compute for 730 hours is about USD 19.35 before storage/recovery/transfer charges; scale-to-zero savings depend on actual idle periods. [Neon pricing](https://neon.com/pricing).
- Neon spending notifications are alerts, while resource quotas can suspend computes. Autoscaling size limits do not cap accumulated monthly usage, and suspended computes still leave stored data charges. [Consumption limits](https://neon.com/docs/guides/consumption-limits).
- Neon pooling uses transaction-mode PgBouncer. Tenant context must be transaction-scoped with the protected work, and migrations may need a direct connection. [Pooling](https://neon.com/docs/connect/connection-pooling).
- Better Auth's maintained library is MIT licensed and runs inside the Next.js application. Auth endpoint configuration, updates, schema rollout, email callbacks, and shared production rate limiting are application responsibilities. [License](https://raw.githubusercontent.com/better-auth/better-auth/main/LICENSE.md), [installation](https://better-auth.com/docs/installation), [rate limits](https://better-auth.com/docs/concepts/rate-limit).
- The Better Auth Drizzle adapter needs explicit transaction configuration with a compatible driver; selecting PostgreSQL alone does not enable its transaction callback. Check the pinned release during implementation. [Adapter source](https://github.com/better-auth/better-auth/blob/main/packages/drizzle-adapter/src/drizzle-adapter.ts).
- Resend's current free transactional band is 3,000/month and 100/day; receiving consumes the same quota. Its acceptable-use policy prohibits cold outreach. The account and invitation use case need policy review before activation. [Pricing](https://resend.com/pricing), [acceptable use](https://resend.com/legal/acceptable-use).

Remaining provider research and activation constraints are recorded in [service-research.md](service-research.md).

## Remaining implementation and activation inputs

- Pin the selected Effect, TypeScript, shared Node runtime and Tailwind/shadcn versions during scaffolding; verify discovery's route/task error mapping, cancellation and transaction behavior on the selected hosts.
- Authentication/authorization integration, environment isolation, file-retention rules, and backups.
- Plan limits, worker schedules, concurrency, retry behavior, and spending guardrails.
- Initial OpenAI model profiles, numeric API/fallback/search budgets, the executed Exa MSA/order scope/quote, and allowed MCP capabilities.
- Native Gmail/Graph grant scopes, synchronization/recovery details, production verification/security-assessment costing, and email delivery behavior appropriate to each approved mode.
- Meta Tech Provider/onboarding/coexistence and customer billing setup, human-led phone support, Razorpay activation/commercial terms, billing/tax implementation details and native calendar account/capability validation.

Provider selections record the interview decisions. Paid plan activation, optional products, and the complete budget still require verified current terms and explicit costing.
