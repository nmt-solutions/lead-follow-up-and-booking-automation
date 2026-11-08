# Business billing profiles and evidence

Issue #41 implements customer identity and evidence for the direct-selling decision in ADRs 0006/0007. It does not calculate tax, choose an exemption/export treatment, configure prices, issue invoices or activate gateway billing.

Owners and Admins open **Billing profile and evidence** from their Business profile. A profile can be saved with missing fields. Every save appends a complete, attributed revision; `expectedVersion` prevents stale or concurrent edits from replacing a newer version. The current revision ID, legal details and attached document name/hash/retention snapshots are available to later billing commands. Issued financial documents must copy the applicable revision and calculation details into their own immutable snapshots.

## Evidence and review

Upload financial documents from the billing screen. These use the existing private file lifecycle with immutable `purpose = billing`, rather than general files readable by salespeople. Attach only completed, unexpired billing documents from the same Business, with a claim type and supporting note. File storage, type/size limits, access expiry, retention and cleanup configuration remain those of [private files](private-files.md); no additional allowance or retention period is assumed here. History retains attachment metadata after file deletion. Current readiness detects unavailable, expired or purged attachments without rewriting history.

Business Owners/Admins can read their financial history. Salespeople cannot read billing profiles, billing file metadata, usage or contents. Cross-Business access is denied. Ordinary Business administration grants no global review authority.

An operator provisioned separately with `platform_operator.tax` and a fresh operator MFA session opens `/platform/billing` (also linked from Businesses for an authorized operator). The queue contains submitted profiles requiring review. Operators can retrieve billing files through short-lived, actor-bound access grants, but this operator path cannot upload/delete files or retrieve general Business files. The persisted tax grant is checked again on each operation.

Each review appends an attributed decision bound to the exact current profile revision. Both `expectedVersion` and `expectedReviewVersion` are required. A changed profile needs another review; previous decisions remain visible. Review states are:

- `missing`: incomplete identity/contact/address, unknown applicability/status, missing supporting claims/documents, unavailable evidence, or recorded missing findings.
- `conflicting`: contradictory tax identifier declarations, duplicate identifier types/countries, or recorded conflicting findings. Conflict takes precedence over missing information.
- `pending_review`: the submitted evidence is structurally complete and awaits an operator decision.
- `reviewed`: an authorized operator recorded an evidence review with no unresolved findings. This is identity/evidence review only, never tax treatment or permission to bill.

The customer declaration that an identifier is not applicable still needs review. A Business checkbox or foreign address does not establish tax exemption. Unknown billing country has no currency; the ADR's explicit configuration maps India (`IN`) to INR and other supplied ISO countries to USD. This classification is separate from discovery geography and planning FX, and implies no supported tax jurisdiction, price or international gateway activation.

## Interfaces and database deployment

- `GET/PUT /api/businesses/:businessId/billing`: own-Business workspace and append a revision.
- `GET /api/platform/billing`: operator review queue.
- `GET/POST /api/platform/billing/:businessId`: operator workspace and append an evidence review.
- `GET /api/platform/billing/:businessId/files`, `POST .../files/:fileId/access`, `GET .../files/:fileId/content`: restricted financial evidence retrieval using the existing file protocol.

Apply `pnpm db-push` with the schema-owner `DATABASE_ADMIN_URL` before deploying this application version. The schema adds `billing_profile_revision`, `billing_profile_review` and `business_file.purpose` (existing files become `general`). The security setup reapplies policy expressions, forces RLS, and grants only SELECT/INSERT for financial history. The runtime startup verifier rejects missing/unsafe financial policies or mutable history privileges. The schema filter includes both new tables so repeated pushes preserve them.

Tests use public application commands/queries and HTTP boundaries with real disposable PostgreSQL, real authentication/membership, a controlled clock and deterministic private storage. Live R2 access, deployment-database migration and human UI/acceptance checks require their configured environments and separate execution.
