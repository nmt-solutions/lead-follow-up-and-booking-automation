# Configured subscription quotes

Issue #42 adds commercial price configuration and reviewable quotes, following [reviewed billing profiles](billing-profiles.md). It does not calculate tax, approve or collect payments, issue invoices, reserve workers, change paid entitlements, prorate an upgrade or schedule a downgrade. Those later commands must use their own approved transaction and payment rules.

## Operator configuration

A schema-owner provisioned `platform_operator.pricing` grant, independently of tax/reconciliation grants and Business membership, permits `/platform/pricing`. Every application operation checks the persisted grant and the existing fresh operator MFA requirement. Business Owners/Admins cannot provision this grant. The Businesses page links to pricing when the operator is authorized.

Each attributed, immutable catalog revision contains the complete offered catalog, a reason/approval reference and an effective UTC time. `expectedVersion` refers to the latest saved revision, including scheduled versions. `effectiveFrom: null` means the server's current clock; an explicit time cannot be earlier than now or the latest saved effective time. Versions with the same effective time resolve to the highest version. Publish an empty catalog to withdraw offers. Correct scheduled configuration by appending a replacement at the same or a later effective time; past history is never rewritten.

Every offer identifies its exact discovery markets, monthly discovery and automation quantities/units, independent INR/USD prices, monthly renewal/cancellation terms and optional bounded paid pilot and reserved discovery capacity. Pilot allowances cover the whole pilot; monthly allowances cover each month. Reserved capacity specifies its execution quantity/unit and additive pilot/monthly price separately. Pooled capacity has no reserved-capacity line item and uses the same privacy/authorization boundary.

There are no seeded prices, units, quantities, markets or FX conversions. Prices are explicit positive integer minor units; INR and USD use two decimal places. The operator form accepts decimal amounts without floating-point multiplication of the fractional part. Missing currency prices and allowances are persisted as `null`, not inferred from another currency or unlimited usage. An explicit allowance quantity of zero means zero included units. Missing initial, renewal, selected reserved-capacity or pilot configuration prevents a quote. Upper numeric bounds and distinct offer/capacity/market validation reject invalid configurations.

## Business quote contract

Owners/Admins open **Subscription quotes** from their own Business profile. Salespeople, foreign Businesses and global pricing operators without that Business membership cannot read or write its quotes. Currency follows the current reviewed billing details: INR for India, USD internationally, unknown otherwise. Reach never changes the billing classification.

`createQuote` accepts `offerId`, nullable `reservedCapacityId`, `term` (`monthly` or `paid_pilot`), `expectedCatalogVersion`, `expectedBillingVersion`, `expectedReviewVersion` and a UUID `requestKey`. Prices and billing details are never accepted from the caller. The command rechecks authorization, effective configuration, current revision-specific billing review and live supporting evidence in a Business-scoped transaction. Business and catalog locks serialize concurrent billing/catalog changes and duplicate commands. A repeated Business/request key with identical normalized input returns the same quote; a changed payload conflicts. Authorization is checked before returning a replay.

The immutable quote snapshot preserves the complete legal profile/evidence metadata and its review, selected catalog revision/offer/capacity, independent currency, itemized initial and monthly renewal subtotals/allowances, terms, creator and controlled timestamp. The snapshot explicitly records:

- Meta is paid directly by the Business, excluded from platform subtotals, with no prepaid credit or guaranteed message count. Its bill is not recorded as operator spend or charged again by this module.
- Tax is `not_calculated`; tax amount and final payable total are `null`, never zero or an inferred exemption.
- `grantsEntitlements` is false. Quoting has no payment-provider, worker, discovery allowance or reach activation effect. Extra spend still needs separate approval.

The public `quote` query and workspace return the snapshot plus a **current assessment**. `commercialReady` means only that the quoted catalog and reviewed billing details are still current, with available evidence. An effective catalog change, billing revision/review change, deleted or expired evidence, or withdrawn configuration makes the relevant assessment unavailable without changing the snapshot. A future catalog does not supersede a quote until its effective time. `checkoutReady` remains false, with explicit `tax_calculation_required` and `gateway_checkout_required` launch gates.

Later tax/checkout work should re-read `quote` under the authenticated Business context, require `commercialReady`, bind its own calculation/approval to the immutable quote ID, and apply current-state checks atomically with its durable side effects. A cached assessment, quote ID, browser redirect or historical quote is never payment authority. No quote expiry, price-lock commitment, automatic pilot activation or renewal mandate is assumed here.

Reach describes future discovery and new-prospect campaigns; incoming inquiries/engaged conversations remain geographically independent under applicable communication rules. Actual allowance consumption, paid activation, upgrades/downgrades and operational capacity scheduling belong to their respective workflows.

## HTTP and deployment

- `GET/POST /api/platform/pricing`: operator catalog/history and append a complete version.
- `GET/POST /api/businesses/:businessId/subscription-quotes`: own-Business workspace and create an immutable quote.
- `GET /api/businesses/:businessId/subscription-quotes/:quoteId`: current commercial assessment and preserved snapshot.

Mutations enforce configured same-origin JSON requests with a bounded body and strict input schemas. Responses are uncached. Unexpected errors use the existing generic HTTP response/request ID and sanitized code-only diagnostics. No provider, credential or customer payload logging is added.

Apply `pnpm db-push` using the deployment's schema-owner `DATABASE_ADMIN_URL` before deploying this application version. The schema adds `subscription_pricing_revision`, `subscription_quote` and `platform_operator.pricing` (default false), with forced RLS and only SELECT/INSERT history privileges for the runtime. Quote insert policy checks that billing/review references belong to the same Business. The startup verifier rejects absent/unforced commercial tables, missing policies, owner/bypass roles and table- or column-level mutation grants. Schema push filtering and security reapplication retain both tables. This ticket's isolated checkout only runs disposable database checks; the parent merger owns applying the configured deployment database schema.

The application-seam suite uses real PostgreSQL, membership/authentication, deterministic evidence storage and a controlled clock. There are no actual external commercial integrations in this quote-only module; current provider activation/currency/card/tax/legal prerequisites remain separate launch inputs. UI validation and user acceptance remain pending.
