# Service-provider selection review

Snapshot: 2026-11-05. This summarizes the accepted choices in [tech-stack.md](tech-stack.md), with costs in [operating-costs.md](operating-costs.md), provider facts/conditions in [service-research.md](service-research.md), and product requirements in GitHub issue #1. Provider selection is separate from account activation and live use.

| Responsibility | Accepted choice |
| --- | --- |
| Web application/API | TypeScript, Next.js App Router and React on Vercel Pro |
| Implementation style | Effect for discovery orchestration; conventional Next.js handlers and other workflows under the corrected [TypeScript guide](ts-coding-guide.md); Trigger.dev retains durable execution |
| Website UI | Tailwind CSS and shadcn/ui; both `apple-design` and `apple-design-diwu` required for frontend implementation and review under [the frontend rules](agents/frontend.md) |
| Database and access | Neon PostgreSQL, Drizzle/Drizzle Kit, `pg`, shared Business-scoped records with server authorization and non-bypassed RLS |
| Authentication | App-hosted Better Auth, Owner/Admin/Salesperson roles, separate Platform Operator, privileged MFA, minimal required plugins |
| Durable execution | Trigger.dev Cloud, initially lowest suitable paid tier |
| Private files | Cloudflare R2 Standard, private signed access and US jurisdiction |
| AI | Vercel AI SDK and AI Gateway, initially operator OpenAI BYOK using eligible Pro USD 100 API credits; small budgeted Gateway fallback |
| Search/retrieval | Exa Search + Contents under an executed MSA/order; Auto default, Lite for suitable focused lookups; order/retention/export/data scope and actual quote still required before activation |
| Transactional email | Resend for auth/platform notices; free band only while volumes/eligibility fit |
| Customer mailboxes | Native Gmail API and Microsoft Graph, app-owned OAuth/token/sync/recovery and production verification responsibilities |
| WhatsApp | Direct Meta Cloud API; customer-owned account/number and direct customer-paid Meta usage; our automation subscription priced separately |
| Subscription payments | Razorpay direct selling; INR for India, USD internationally, recurring cards first; UPI after its separate change/mandate flow is validated |
| Billing and tax | Our app owns tax rules/evidence/calculations, invoices/credit notes, refunds/disputes, obligations/reports/filing/remittance records and reconciliation |
| Monitoring | Provider-native logs plus app-owned audit, error/health records and budget alerts; no separate observability subscription initially |
| Appointment booking | Native Google Calendar/Microsoft Graph calendar adapters with separate grants and app-owned booking logic; validate actual personal/work account paths; RFQs remain native |

Core web/database/worker region is US East/Virginia where supported; R2's US jurisdiction does not guarantee Virginia. Mail, calendar and Meta customer/provider control planes and residency must be checked separately where relevant.

## Cost ownership and estimate

- Selected fixed infrastructure plan commitments remain USD 30/month: Vercel Pro 20 and Trigger Hobby 10, each with its own included usage credits. Count credits once; do not combine allowances across providers or repeat them per Business.
- An explicit always-active Neon scenario with 1-5 GB database storage puts the priced shared core at about USD 49.70-51.10/month, before excess usage, history, AI/search/payment fees, taxes/FX, verification and unmeasured billing/tax/monitoring work.
- INR planning uses 100/USD, not a live or customer billing rate: the same core is about INR 4,970-5,110. The fixed-infrastructure planning ceiling is INR 10,000; it is not an all-inclusive operating-cost forecast.
- The existing Pro USD 100 subscription is recorded separately. Fully allocating it to this app gives about USD 149.70-151.10/month before the other exclusions; activation/expiry of its API grant and the actual allocation matter. Exa and Gateway fallback charges are separate from that grant.
- Exa's public benchmarks are USD 4/1,000 Lite or USD 7/1,000 Auto, plus Contents at USD 1/1,000 page/content-type units and any extra results. The selected MSA route has no obtained quote/minimum yet; no Enterprise commitment or payment method is pre-approved. [Search decision](search-provider-decision.md).
- Razorpay's provisional international/corporate-card recurring scenario is 4.7082% including fee GST before FX/other charges, using the public 0.99% subscription surcharge assumption. The actual account quote must replace this assumption.
- Meta message charges are paid directly by the Business and disclosed separately from our subscription and operator-paid spend. Our automation/AI/onboarding work still consumes platform resources.

## Inputs before the corresponding live capability

Set numeric model/search/Gateway budgets, actual customer prices and usage allowances; verify provider approvals, scopes/assessment costs and commercial terms; execute Exa's required MSA/order scope and quote; configure supported tax/filing jurisdictions; choose environment isolation, recovery/retention and offboarding policies; and validate the real pilot's provider/account paths. These are explicit implementation/activation inputs, not permission to silently buy another service or claim worldwide coverage.

The approved test boundary remains one primary application-level seam with deterministic search/AI, email, WhatsApp, billing/filing and booking adapters plus a controlled clock. Test internal workflow/persistence and observable effects; add focused real-provider contract checks as integrations are pinned.
