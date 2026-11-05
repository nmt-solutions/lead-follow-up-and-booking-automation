# Prospect Discovery and Sales Automation

## 1. Business concept and stage

Build one configurable subscription product that helps a business find potential customers from public internet information and manage sales inquiries through a business-specific outcome.

The product has two core capabilities:

- **A — Full inquiry and sales automation:** a shared inbox, business-specific answers, qualification, follow-ups, booking or quotation-request workflows, a sales pipeline, human takeover, and reporting.
- **B — Prospect discovery:** context-bound research agents find relevant buyers, publicly listed contacts, and open buying requests, with evidence for each result.

Both capabilities are required. Each customer configures the product around its offerings, buyer types, operating geography, qualification rules, commercial authority, and conversion goals.

**Positioning:** "Find relevant potential customers and manage the conversations that turn interest into business."

Working problem hypothesis: businesses spend staff time finding suitable buyers and keeping inquiries moving across fragmented sources and manual processes. Validate how often this happens, what they already use, and why the combined product would be worth paying for.

The subscription provides sales automation and bounded discovery capacity. Lead counts, appointments, orders, and revenue are outcomes to measure, without fixed-result guarantees.

Stage: proposed business. The product direction is defined; willingness to pay, source coverage, contact quality, operating costs, and repeatable customer value remain unvalidated. Initial delivery is operated by a solo founder with assisted onboarding. Exact prices and launch dates require pilot costing.

## 2. Customers and targeting

Support businesses across industries and geographies through configuration. Examples of buyer relationships include:

- A steel manufacturer seeking fabrication providers and other businesses that use its steel products.
- A scissors manufacturer seeking barbers, tailors, stationery retailers, or other suitable buyers, depending on its actual product range.
- A service provider seeking people or businesses with an explicit relevant requirement.

Business buyers include larger organizations, sole proprietors, business end users, and resellers. A barber purchasing work scissors is a business buyer. An individual purchasing for personal use is an individual consumer; consumer discovery is based on explicit public buying requests.

During onboarding, the customer confirms:

- Products or services, relevant specifications, minimum order requirements where applicable, and delivery or service constraints.
- Buyer categories suggested by the product, with customer refinements and exclusions.
- Its home market and any selected additional markets.
- Qualification rules, approved business information, conversion goals, and commercial permissions.
- Sales mailboxes, communication identities, team access, and human escalation contacts.

The home market is the customer's confirmed operating/service geography. Its address may suggest an initial setting, but the customer confirms where it can sell or deliver. Discovery prioritizes that market by default; selected and international markets are optional paid reach.

## 3. Buyer and opportunity model

Use the terminology in [GLOSSARY.md](../GLOSSARY.md).

Discovery identifies prospects. A prospect becomes an engaged lead when it directly inquires with the business or replies with buying interest. A public buying signal alone does not establish engagement with the subscribing business.

Track distinct purchasing needs as separate opportunities linked to the buyer. Repeated messages about the same need belong to the same opportunity. For example, unrelated requests for steel sheets and pipes may be separate opportunities for one fabrication business.

Preserve the difference between:

- An evidence-backed match and a contactable prospect.
- A buyer contact and a general business contact.
- Contact availability, channel eligibility, customer approval, and actual engagement.
- A booking request, confirmed appointment, attended appointment, quotation request, issued quote, and customer-recorded sale.

## 4. B — Prospect discovery

### Discovery brief and execution

Each discovery brief captures the offering, product requirements, target buyer categories, geography, exclusions, and the kind of buyer/contact sought.

Run discovery on demand or through saved searches with a customer-selected schedule and usage allowance. Agents use approved web search tools, MCP connectors, and public-page retrieval within that brief and the source coverage available to the service.

Use pooled workers by default, with isolated customer context for every run. Offer paid dedicated/reserved execution capacity where commercially justified. Dedicated capacity is an execution-resource option, not a separate requirement for keeping customer context private.

Every run has a visible resource/credit budget. When it reaches the limit, return the partial sourced results, completed work, spend/allowance used, and stop reason. Additional spend requires approval. Consolidate duplicate results across runs within the customer's workspace.

Maintain declared coverage by source, geography, and data type. Access conditions and available evidence determine which sources can be supported. Vendor and connector selection remains part of pilot costing and source validation.

### Two discovery sections

**Potential buyers:** public evidence supports fit with the customer's offering and geography. General product consumption, business activity, or expansion may support relevance without proving a present purchase request.

**Open buying requests:** an explicit, dated request for a relevant product/service that the source still shows as open. Display the source, request date, relevant requirements, and deadline/status where available. Uncertain or expired status must be explicit and must not be counted as established open demand.

Consumer opportunities must remain tied to the relevant public buying request. A request's visibility supports discovery; sending eligibility is assessed separately.

### Evidence and contact quality

Each match should expose:

- The prospect and why it fits the discovery brief.
- Supporting source URLs and retrieval/check date.
- Geography and relevant product/use evidence.
- Contact classification: buyer contact, general business contact, or contact missing.
- Whether a named person's buying responsibility is supported or remains unverified.
- Buying-request status and uncertainty where relevant.

The target contact is the person responsible for purchasing or supplier selection: a procurement/purchase lead, another relevant buyer, or the owner.

Retain strong company matches when only a general mailbox, switchboard, or contact form is available. Clearly mark the missing buyer contact. Count evidence-backed matches separately from contactable prospects and report named-buyer coverage separately.

## 5. A — Full inquiry and sales automation

A handles direct incoming inquiries and conversations arising from B's approved outreach. It remains a full product capability, including:

- A shared sales inbox and opportunity pipeline.
- Answers grounded in the customer's approved offerings, information, and policies.
- Qualification that collects missing details and applies the customer's rules.
- Follow-ups driven by the current conversation and opportunity state.
- Booking or quotation-request workflows aligned to the chosen conversion goal.
- Human takeover, assignment, activity history, and outcome reporting.

Commercial authority is configurable per customer. The customer decides whether the service may send listed prices, create custom quotations, grant discounts, or accept orders, and sets the associated limits. Commercial actions require approval until automatic permissions are explicitly enabled.

Check current permissions and authoritative business information before executing an action. Prices, availability, booking confirmations, and order commitments must be supported by the business's approved rules and systems. Cases outside that authority go to a person.

For appointments, use customer-owned Google or Microsoft calendars through native integrations, with calendar access granted separately from email. The application owns availability, booking rules, holds, time zones, retries and conflict recovery; confirm only after the authoritative calendar event is created and recorded. Validate the supported personal/work account path before declaring a calendar ready. Quotation-request workflows remain native and do not require a calendar unless an appointment is requested.

Before first outreach to discovered prospects, the business approves the recipient set, initial messages, and bounded follow-up sequence: message content, timing, maximum attempts, and stop conditions.

A reply ends the unanswered-message sequence. An opt-out stops the applicable further outreach. A human takeover pauses automated messages across all channels for that opportunity until control is explicitly returned; other opportunities continue. Detect manual replies from connected mailboxes and supported WhatsApp app workflows.

Recheck current opportunity state immediately before a scheduled action. Prevent duplicate sends on retries. If reply visibility fails, pause affected follow-ups and surface the issue. Keep human handoff and the next responsible person visible.

## 6. Email strategy

### Sender options and production policy

Distinguish three setups:

1. **Connected mailbox:** the business authorizes sending and synchronization of sales conversations through an existing mailbox.
2. **Verified sending domain:** the business demonstrates control of a domain/subdomain and authorizes sending through it. Reply routing/capture is a separate setup requirement.
3. **Service-provided address:** a business-specific address on a domain operated by the service.

First-contact prospecting requires a connected customer-controlled mailbox or verified customer sending domain. Service-provided addresses initially support trials, incoming inquiries, and existing conversations, with truthful business/platform identification.

B uses a dedicated outreach address per business, and its replies flow into A. The ordinary sales inbox can be connected separately. Customers can continue working in Gmail/Outlook while the service synchronizes relevant conversations and detects human replies.

Sending access and reading/synchronizing replies are distinct permissions. Domain verification alone does not connect an existing inbox. [Gmail permissions](https://developers.google.com/workspace/gmail/api/auth/scopes), [Microsoft mail integration](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview?view=graph-rest-1.0), [domain verification](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html), [inbound email setup](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-setting-up.html).

The customer explicitly selects the sales mailboxes or conversations A processes. Historical imports are optional. A connection does not automatically make the entire mailbox history part of the business context.

### Authenticity, sending health, and eligibility

Use accurate sender identity, authenticated domains, working reply handling, and the applicable receiver-provider requirements. Design for SPF, DKIM, and DMARC alignment, appropriate unsubscribe handling, suppression, and measured sender limits.

Monitor authentication, delivery failures, and recipient complaints. Authentication failure or excessive bounces/complaints pauses the affected sender's outbound automation and alerts the customer and service operator. Keep incoming mail and records available; resume sending after resolution.

Inbox placement is controlled by recipient providers and reputation signals. A dedicated address/subdomain does not establish complete reputation isolation when infrastructure or parent-domain reputation is shared. [Google sender guidelines](https://support.google.com/mail/answer/81126?hl=en), [Google sender FAQ](https://support.google.com/mail/answer/14229414?hl=en), [Yahoo sender requirements](https://senders.yahooinc.com/best-practices/).

Evaluate email eligibility separately from contact availability, paid reach, and customer approval. Consider destination, recipient type, message purpose, relevant permission/relationship evidence, sender identity, and opt-out state.

Country and recipient-type differences matter: the FTC's guide covers US commercial email, including B2B; the ICO's published guidance distinguishes companies from sole traders and other individual subscribers. Supported-market policies require review before automated sending is enabled. [FTC guidance](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business), [ICO guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/).

## 7. Phone and WhatsApp

Initial phone support is human-led calling with written notes, outcomes, and next actions. Autonomous AI voice calling is a separate optional later capability.

Each customer controls its WhatsApp business identity and associated number. Offer connection of an existing number or assisted setup of a new customer-controlled number. Check the supported onboarding path before promising that an existing Business App workflow can be retained. Meta provides a specific coexistence path for eligible Business App onboarding. [Business onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview), [Business App coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).

Use Meta Cloud API directly with each Business's own account/number and payment method. The Business pays Meta for messaging; our subscription covers the automation service. Show these charges separately in quotes, onboarding and usage views, without counting Meta's bill as included operator-paid credit. Platform/recipient permissions and messaging limits still apply. Provider approval and account/coexistence eligibility remain production prerequisites.

Recipient permission and WhatsApp's messaging rules are separate from discovering a public number. Business-initiated messaging requires the appropriate approved templates and recipient opt-in. Ordinary replies are available within the 24-hour customer-service window; outside it, templates are required. Automated handling must provide a clear human escalation path. [WhatsApp messaging policy](https://business.whatsapp.com/policy).

Number provisioning, customer control, and any transfer/portability conditions must be made clear during assisted setup. Email, telephone, and WhatsApp each need their own channel strategy and eligibility checks.

## 8. Geographic reach, subscription, and billing

Geographic subscriptions control B's discovery coverage and new-prospect campaigns. A continues handling incoming inquiries from any geography, subject to the applicable communication and action rules.

Use one clear subscription quote combining:

- Selected geographic reach, with the customer's home market prioritized by default.
- Included discovery and messaging-automation allowances, with customer-paid Meta messaging charges disclosed separately.
- Optional dedicated/reserved discovery capacity.
- Customer-approved upgrades or additional usage.

Wider and narrower reach changes the subscription price. Price discovery and communication usage together with their operating costs; country count alone is not the complete model.

Keep our subscription/usage charges separate from provider bills paid directly by the Business. In the selected WhatsApp arrangement, Meta charges are a customer expense, while our AI/infrastructure/automation usage remains part of our operating economics. Do not charge twice for the same Meta consumption or imply the subscription prepays Meta's bill.

Reach upgrades take effect immediately after the customer sees and approves the prorated charge. Reductions take effect at the next renewal. Retain previously discovered records and engaged conversations, and adjust future discovery permissions when the change takes effect.

Paid international coverage does not establish permission to contact every discovered recipient. Sending eligibility remains a separate check.

Sell platform subscriptions directly through a payment gateway, with the service operator as the seller. Implement billing and tax management as part of the application: Business billing profiles and tax identifiers/evidence, configurable tax rules and calculations, numbered invoices and credit notes, payment/refund/dispute records, subscription entitlements, and reconciliation from gross payment through fees/FX to bank settlement.

The application also manages the operator's subscription-related tax registrations/obligations, reporting periods, due dates, liability reports, filing/remittance status, supporting documents, approvals and audit history. Support accounting/filing exports and record authoritative submissions/payment confirmations; automated external filing/remittance requires a supported jurisdiction and integration. Preserve issued invoice details and the tax rules/evidence used for each transaction; unknown treatment requires review rather than an assumed exemption.

Keep platform-wide tax administration under platform-operator authority and each Business's billing records isolated. Gateway payment confirmation and recurring-payment state feed application-owned billing; the gateway does not replace the seller's invoice or tax responsibilities.

Start with INR billing for Indian Businesses and USD billing for international Businesses, with other billing currencies added later. Use Razorpay as the initial gateway with recurring cards first; UPI AutoPay follows validation of its separate upgrade/new-mandate workflow. Cashfree remains a researched alternative if approval or terms are unsuitable. Determine the billing-country classification from confirmed Business billing details, separately from discovery geography. Processor settlement currency can differ from the customer invoice and must be reconciled explicitly.

Exact plan amounts, allowance units, Razorpay activation/commercial terms, applicable jurisdiction rules, provider fees, filing integrations and detailed billing edge cases must be settled before commercial billing. Set prices and rollout dates after pilot costing; choosing INR/USD does not set price amounts or a customer exchange-rate policy.

## 9. Onboarding and operating model

Assist the first paid pilots with:

1. Business offerings, buyer categories, home market, exclusions, qualification rules, and goals.
2. Sender/mailbox connections, authentication, selected processing scope, and reply capture.
3. WhatsApp identity/number onboarding where included.
4. Commercial authority, recipient/message approvals, follow-up limits, and human ownership.
5. Discovery briefs, schedules, geographic entitlements, and spend limits.
6. A checked workflow for incoming messages, manual replies, opt-outs, retries, and handoffs.

Introduce self-service onboarding after the setup process is repeatable. The customer's team owns business decisions and sales exceptions; the service operator owns platform operation and support.

The high-level system needs customer configuration and access roles, durable prospect/opportunity/message records, an evidence store, a job queue, bounded discovery workers, channel adapters, application-owned subscription billing/tax management, reporting, and an audit trail. AI supports research, extraction, and language work; authoritative state and permissions control actions.

Keep customer context and credentials isolated. Treat external web pages and incoming messages as evidence/content, with execution governed by the customer's approved configuration and platform controls.

Use Exa Search + Contents through the MSA/executed-order route for discovery and source verification. The order must cover durable derived lead/contact facts, evidence URLs/dates/short excerpts, customer display/export and post-cancellation retention, with the actual data/commercial terms agreed before activation. Use minimal public/business-level queries and keep private mailbox/business context out of the external search payload unless supported by the applicable agreement. Initial monitoring uses provider-native logs plus app-owned audit, error/health records and budget alerts, with no separate monitoring subscription.

## 10. Validation and rollout

The first milestone is one business completing a paid pilot and renewing at a monthly price agreed before the pilot starts.

Cost and scope that pilot around a real business, its offering, home/selected markets, source coverage, communication channels, observed inquiry volume, and conversion goal. Set numeric acceptance criteria before activation.

Evaluate:

- **Discovery:** product/geographic fit, evidence coverage, duplicate rate, named-buyer coverage, contact accuracy, open-request freshness, and cost per evidence-backed/contactable result.
- **Inquiry handling:** response coverage/time, qualification, engaged conversations, chosen conversion-goal outcomes, handoffs, manual effort, and failure handling.
- **Sending health:** delivery failures, complaints, opt-outs, suppression, and paused automation.
- **Economics:** actual AI/search/tool, hosting, messaging, and provisioning costs; setup/support and founder sales time; payment costs; and contribution after the measured costs.
- **Customer value:** outcomes and time saved relative to a baseline, followed by the paid renewal decision.

Keep bookings, attended appointments, quotation requests, issued quotes, and sales outcomes distinct. Report attribution limits rather than treating every recorded outcome as incremental revenue.

After the first paid renewal, test a materially different workflow before expanding onboarding. A supplier handling quotation requests and a service business handling appointments are example contrasting pilots. This tests configuration reuse while the product's intended market remains cross-industry.

## 11. Assumptions and launch gates

The main hypotheses are that customers value the combined A/B workflow, public sources provide enough relevant evidence and usable contacts, configuration is reusable across businesses, and subscription revenue can cover research, communication, setup, and support.

Carry these as explicit decisions for pilot costing, onboarding, and the relevant production launch:

- The first real customer, offering, search brief, conversion goal, and acceptance thresholds.
- Founder weekly availability and cash budget; both remain unspecified.
- Approved source/connector coverage, access conditions, refresh policy, and contact verification methods.
- AI/search/email/telephony/payment providers, supported integrations, and actual operating costs.
- Enabled outbound markets and their recipient/channel eligibility policies.
- Exact INR/USD prices and allowances, Razorpay activation/fees and supported upgrade/mandate flows, configured tax jurisdictions/rules and filing integrations, and remaining entitlement edge cases.
- Customer data access, retention/deletion, export, cancellation, number provisioning/transfer, and connection-offboarding policies.

The design-session source checks establish relevant platform and policy constraints, not a universal launch approval. Recheck the chosen providers and supported markets before live use.

**Next action:** choose one real pilot customer, collect its business context and baseline, verify source/channel coverage, and prepare a bounded pilot quote with the renewal price agreed upfront.
