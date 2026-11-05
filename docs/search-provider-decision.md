# Search provider decision

Final provider selection: **Exa Search API + Contents API under an executed MSA/order form**, dated 2026-11-05. The provider and integration route are settled; no account, contract or purchase has been activated. The actual order, permitted usage and commercial terms remain prerequisites to production.

## Why Exa

Our product needs reusable Business-scoped prospects, public work-contact facts, evidence URLs/check dates, short supporting excerpts, and customer display/export. Exa's search/retrieval and company/people research capabilities fit those tasks. Search results remain candidates: verify buyer role, geography, provenance, dates and request status from the underlying source. No API quality benchmark has been run in this repository. [Company/people capabilities](https://exa.ai/docs/search/data/companies-people), [GTM use case](https://exa.ai/use-cases/gtm).

The important new finding is the MSA linked from Exa's current [agreement page](https://exa.ai/msa), version filename `v2.2026-09-17`, header effective 2026-09-16. Sections 1.3/1.10 define Customer Data to include returned Output, section 2.1 supports Customer Products and end users, and section 4.1 assigns Customer Data ownership between the parties. Sections 8.4/8.6 support surviving ownership rather than a general deletion of all Output; continued retention is an inference, so the order must explicitly state our retention/export scope. The preamble and sections 1.9/2.2 require an executed Order Form; publication is not proof that self-serve signup accepts it. [Current MSA PDF](https://exa-public.s3.us-east-1.amazonaws.com/Exa%20-%20Online%20Master%20Subscription%20Agreement%20%28v2.2026-09-17%29.pdf).

The general [ToS](https://exa.ai/terms) includes API information within broad copying/extraction restrictions while allowing documented API uses. Do not use those general terms alone as proof of permission for the complete commercial workflow. The MSA route resolves which contract to obtain; it does not claim an order is already signed or waive source/publisher rights.

## Initial configuration

- Our application exposes a provider-independent search/retrieval interface. Use explicit Search/Contents API calls for typed inputs, cost attribution, result limits and retries; an allowlisted MCP wrapper can expose the same operations later.
- Use Auto search for semantic buyer discovery and buying-request research. Use Lite for focused keyword/domain lookups where its results are adequate. Default to at most ten results per request; additional result volume requires budgeted configuration.
- Retrieve content only for shortlisted URLs and select only the needed content type. Preserve the source URL, source/check dates, relevant factual evidence, role uncertainty and record provenance. Do not automatically store entire websites or mix one Business's private context with another's.
- Use public company/product/role/geography query fields. Keep private mail, internal price lists, credentials and identified-person inputs outside the request unless the executed agreement/data terms explicitly support them.
- Confirm an Open buying request from explicit, dated source evidence still shown as open; freshness filters and a search hit are not proof. Missing role/contact facts stay missing rather than becoming inferred email/phone guesses.
- Our AI agents and approved workflow own orchestration. Exa Agent, Answer, Websets, Monitors, Connect and paid contact-enrichment products are not initially selected; adding them needs scoped capability, usage and contract review.
- Retain public business-contact facts and short evidence only within the executed order and source rights. Enforce the application's recipient eligibility, opt-out and outreach-approval rules independently.

## Procurement scope

[exa-order-scope.md](provider-requests/exa-order-scope.md) is a prepared scope for the provider's order, not a sent message or accepted contract. It covers durable lead/evidence records, derived facts, paying-customer display/export, continued retention after cancellation, the actual approved outreach workflow, DPA/query-data handling, and the exact fees/payment method. Do not buy an unspecified Enterprise minimum or treat the public PAYG page as a negotiated quote.

Before live use, record the executed agreement/version and scope, check query/data permissions and privacy commitments, set application/provider usage limits, and reconcile the actual price meters. A refusal or commercially unsuitable order reopens provider procurement; it does not authorize silent fallback to another provider's restricted plan.

## Alternatives reviewed

| Provider/route | Result for this workflow |
| --- | --- |
| Exa MSA/order | Selected route: customer products and output ownership are documented; execute the specific retention/display/export scope and actual commercial terms. |
| Exa general/self-serve ToS | Not sufficient evidence for our full workflow by itself. |
| Brave ordinary Search | Standard terms/FAQ permit only transient storage. Custom storage/display/export/termination rights need an overriding order; no current public storage-tier quote was established. |
| Firecrawl hosted / SerpApi | Technical extraction/search is available, but their public restrictions/permissions do not clearly grant our complete persistent paid-customer output/export use. Their enrichment examples or Legal Shield are not a substitute for that grant. |
| Valyu | API-specific limits on derivative datasets, caching/export and post-termination records conflict with the required durable lead store. |
| You.com | Customer/output rights exist, but the current AUP's search-content retention and individual-profile restrictions leave the work-contact/evidence workflow unresolved without express authorization. |
| Parallel | Customer-app use is supported, but current restrictions on database/data-selling uses, stored output reuse and customer sharing make it an unsuitable default for this lead-record product without an amended agreement. |
| Tavily | The reviewed AUP restricts output use facilitating unsolicited marketing; retain as unselected research rather than presume manual approval changes the provider's rule. |

Sources: [Brave terms](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service), [Brave FAQ](https://api-dashboard.search.brave.com/documentation/resources/help-feedback), [Firecrawl terms](https://www.firecrawl.dev/terms-of-service), [SerpApi terms](https://serpapi.com/legal), [Valyu agreement](https://www.valyu.ai/valyu-platform-service-agreement), [You.com MSA](https://you.com/msa), [You.com AUP](https://you.com/aup), [Parallel customer terms](https://parallel.ai/customer-terms), [Tavily AUP](https://www.tavily.com/acceptable-use-policy).

## Cost basis

Exa's published PAYG reference rates are USD 4/1,000 Lite requests, USD 7/1,000 Auto requests and USD 1/1,000 Contents pages per content type; the first ten search results are included, while extra results and selected summaries add meters. For example, 1,000 Auto searches plus 2,000 single-type Contents page units total USD 9 before extras/taxes. These are priced-unit illustrations, not a production workload forecast. [Pricing](https://exa.ai/docs/admin/pricing).

The MSA order sets its actual fees, commitments, payment method, tax/withholding and overage terms. No MSA minimum/quote has been obtained. Keep those unknown rather than promising USD 0 fixed search cost. The operator's existing OpenAI API grant does not pay Exa; record Exa spend separately and avoid double-counting prepaid cash and consumed credits. See [operating-costs.md](operating-costs.md).
