# Production subscription release

Commercial version: 2026-11-10. Read [the verified cost research](production-subscription-research.md) for rates, assumptions, margins and legal sources. This release prepares self-service subscription screens and preserves the existing financial authority model. It is **not yet an approved live launch**.

## Published plans

One subscription per Business; all authorized members share its allowance. The canonical public manifest is `src/content/plans.ts`. The immutable database catalog was published as revision 1 through the owner release tool, at the account holder's request. No customer was charged and no entitlement was granted.

| Monthly, before applicable tax   | Starter | Growth |  Scale |
| -------------------------------- | ------: | -----: | -----: |
| INR                              |   1,999 |  4,999 |  9,999 |
| Discovery credits                |   1,200 |  4,000 | 10,000 |
| Outbound provider-call allowance |     500 |  2,000 |  5,000 |
| Included market                  |   India |  India |  India |

The internal cost model includes Exa, bounded AI tokens, Trigger compute/invocations, Resend, Razorpay fees and fee tax, Vercel, Neon, R2, FX/retry reserves, support and compliance/accounting reserves. These are estimates, not provider spending guarantees. No raw token/worker/storage/seat entitlement is advertised. Shared infrastructure is not charged once per customer seat. Meta and customer mailbox/phone bills are separate. There are no automatic overage charges.

Discovery definitions must match the live policy: `discovery credits`, search 8, Contents page 1, evidence review 1; bounded products, result count, content types, AI context and attempts are required. Automation uses the existing exact `provider calls` unit. Policies with different units are not compatible merely because the quantity matches.

## Customer flow and security

`/pricing` → selected plan preference → distinct signup → email verification and authenticator → business setup → optional email/calendar → optional plan setup → first search. Every optional connection and plan step has a setup-later route. The saved address and invoice identity are reused. A plan preference contains only a public ID; it cannot authorize a price, payment or access.

`/businesses/:id/subscribe` separates plan, billing and exact tax/renewal review. The final recurring authorization opens Razorpay's validated hosted subscription URL. Only native capture/reconciliation grants a paid period. The server rechecks the current immutable offer against the public manifest. The browser never supplies an accepted price, tax amount, paid period or allowance grant.

`/businesses/:id/plan` provides allowance status, invoices, payment refresh and cancellation. Advanced payment history and card settings remain available. Cancellation records intent before provider I/O and uses the existing uncertain-outcome recovery; it does not imply a refund. A provider-confirmed cancellation preserves paid-through access under the accepted policy.

Domestic billing declarations are immutable, attributable customer statements. They do not establish independently verified identity or GST registration. Owners/Admins can confirm their own Business; Salespeople and outsiders cannot. The ordinary profile-save endpoint cannot forge a declaration, and the platform review endpoint remains operator-only. A restricted, scoped SQL predicate prevents declarations from overriding unresolved operator findings.

Tax rules default to document evidence. A genuinely approved domestic INR **taxable** rule may explicitly set `evidenceBasis: "customer_declaration"`. That basis does not authorize reverse charge, export, exemption or other relief. No tax rules or legal facts were fabricated by this release. Existing immutable financial evidence remains protected from deletion.

Customer financial projections strip deployment-wide merchant reviews and internal cost terms. Provider credentials, owner database URLs and global operator pages remain outside customer responses. Public SEO includes only public routes; private routes retain authentication/RLS and noindex defaults. Robots exclusion is not authorization.

## Current external blockers

- Razorpay configuration is **test**, with **zero native plans** and eMandate marked enabled in its retained review. Production composition rejects test-mode credentials. No live tax rules/decisions were present when inspected.
- Seller details were supplied by the account holder and are now published from `src/content/seller.ts`: NMT Solutions (OPC) Private Limited, CIN U47912MH2025OPC438916, GSTIN 27AAKCN1287D1ZE, Kalyan registered address, support phone/email and Wafa Karim Khan as designated grievance officer. These are user-supplied particulars; independent portal verification is not asserted. See [India GST configuration](india-gst-configuration.md) for SAC 998315, standard domestic 18% GST and the private merchant eligibility release. The declarations were subsequently supplied; the compatible invoice version and owner-only activation command complete this tax/issuer stage. Payment and worker activation remain separate.
- Trigger production API access works. **83** allowed runtime settings were synchronized; database-owner credentials, auth session secret and infrastructure-recovery credentials were excluded. The compatible **4.8.3** build succeeded. An actual production upload was attempted; Trigger rejected initialization with **“Deployments are not available for this organization.”** No worker is claimed deployed, no schedules are claimed active and no `TRIGGER_PRODUCTION_DEPLOYMENT_VERSION` was asserted. Resolve the organization's deployment/billing entitlement with Trigger, then rerun deployment.
- Existing discovery/AI/capacity and provider rights remain explicit provisioning requirements. New Businesses must receive a compatible approved discovery policy, funded AI configuration and current deployed pooled-capacity binding before acquisition runs. The current operator-provisioned discovery contract still requires work to become a reviewed fleet default for arbitrary new customer products. **Do not open paid self-service acquisition simply by removing readiness gates.** Verify this provisioning path with a brand-new Business before accepting real customers.
- Live invoice issuer configuration, genuine seller/tax evidence and any provider production approvals must be completed. Application screens and public policies do not prove legal or merchant approval.

## Razorpay side: exact remaining configuration

1. Complete merchant company/bank/signatory verification and website review. The supplied public legal identity, support and grievance details are now available on `/contact` and the footer. Merchant eligibility declarations have been supplied for the tax/issuer release; do not copy private financial declarations into public merchant reviews or invoices.
2. Obtain **live Subscriptions + recurring domestic cards** activation. Use the separately reviewed cards account path; do not silently enable eMandate or share a UPI replacement account. International billing is unavailable in this public catalog. Confirm actual recurring surcharges, card fees, fee GST, amount limits and settlement terms with Razorpay; conflicting public fee pages are not an account contract.
3. After the actual tax treatment is approved, create/map three **monthly INR** native plans to `starter`, `growth`, `scale`, each with no reserved-capacity ID. The native amount must match the app's **tax-inclusive** initial and renewal total. Base prices are 199900/499900/999900 paise. If, and only if, 18% output GST applies, illustrative gross amounts are 235882/589882/1179882 paise. Do not use those gross amounts as an assertion of tax registration or treatment. Confirm the native collection count, UTC calendar-month behavior and cancellation/card-update capability.
4. Configure the live signed webhook at `https://leadrelay.nmtsolutions.in/api/payment-events`. Enable the available subscription lifecycle/charge and payment/invoice events needed by the reviewed account: authenticated, activated, charged, pending, halted, cancelled, completed, expired, paused/resumed and invoice/payment capture/failure as supported. Raw HMAC signature validation and native reconciliation establish authority; event arrival alone never grants access. Configure the separate financial-adjustment webhook at `/api/webhooks/razorpay-adjustments` for enabled refund/dispute events, under its own verified configuration. Keep UPI webhook routes unused unless its independent path is reviewed.
5. Supply live API material through the secret store, not Markdown/chat/repository. Update `RAZORPAY_ACCOUNT_REVIEW` from actual retained evidence and native plan IDs; set a genuine live `SUBSCRIPTION_LIFECYCLE_POLICY` matching monthly cycle-end cancellation and paid-through access. Rotate webhook secrets with the existing overlap mechanism. Same approved values must reach web and workers.
6. Run controlled native payment, renewal, failed-payment recovery, invoice, cancellation and refund/reconciliation acceptance checks. Do not charge the logged-in customer's existing Business to manufacture a test.

## Release commands and verification

```powershell
pnpm db-mig
pnpm exec tsx scripts/publish-subscription-plans.ts <authorizing-verified-email> <expected-catalog-version>
pnpm exec tsx scripts/production-readiness.ts
pnpm exec tsx scripts/trigger-production.ts sync
pnpm exec tsx scripts/trigger-production.ts deploy
pnpm exec tsx scripts/trigger-production.ts inspect
pnpm exec tsx scripts/trigger-production.ts probe <release-id>
pnpm exec tsx scripts/trigger-production.ts run <probe-run-id>
```

The plan publisher is owner-only, optimistic-versioned, append-only and idempotent for identical terms. It grants no platform roles or payment/tax approval. The Trigger synchronizer uploads only approved runtime categories, never prints values, and excludes owner/infrastructure credentials. Declarative recovery schedules are production-only and use UTC. Task limits/retries and single-run payment/notification queues bound accidental overlap. The read-only `production-readiness` task validates the restricted DB role without reading customer records, sending mail or changing payments. Retain the actually promoted version only after deployment, task/schedule inspection and the probe pass.

Public routes added: pricing, contact, cancellation, refunds and digital delivery; existing privacy/terms/guide remain accessible. Public seller defaults now use the supplied legal particulars. An explicitly configured `SELLER_PUBLIC_PROFILE` override is validated and fails closed if invalid; changing public seller data requires a web rebuild for statically generated pages.

Source/intended-flow review applied `apple-design` (immediate feedback, retained input, no transition lock) and `apple-design-diwu` foundation, data entry, onboarding, feedback and account guidance. Existing NMT typography, light semantic theme, glass surfaces and shadcn controls are reused. Financial choices remain explicit. No browser/UI validation was performed; the user owns UI acceptance. Manual acceptance: create a fresh customer, follow plan intent through signup/MFA, skip connections, confirm reused invoice details, verify exact total/renewal, authorize hosted payment, confirm access only after capture, exhaust allowance, download invoice and cancel without a support call. Repeat financial reads/mutations as a Salesperson and an outsider: both must be denied. Retest supported integrations with actual provider approvals.
