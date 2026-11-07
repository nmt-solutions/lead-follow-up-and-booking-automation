# Tax periods and liability review

`/platform/tax/periods` is a global tax workspace. A separately provisioned
`platform_operator.tax` grant and fresh central operator MFA are required. Business
Owner/Admin, document, refund, reconciliation, operations, notification and
customer financial-export rights do not confer tax access. The existing tax grant
already participates in central privileged-role/MFA classification.

## Explicit operating inputs

Save and approve an exact obligation revision containing jurisdiction, fixture or
live mode, reporting currency/timezone, registration or evidenced non-requirement,
effective coverage, source basis, preparers, reviewers and review policy. Each
registration definition and its evidence are versioned inside the obligation.
Creating a draft supersedes configuration for further preparation until its exact
version is approved. Existing documents and reports remain unchanged. Changing
mode, jurisdiction, timezone or currency requires a separate obligation reference.

The supported basis is **original document issue dates**. Select it explicitly;
the application does not determine which legal basis applies. Other required
bases remain unsupported. Captured charges without permanent invoices either
block approval or require an attributable evidenced exclusion under an explicitly
configured issue-date review policy. There is no inferred exemption, registration,
deadline, rate, legal coverage or customer-paid Meta charge.

Open each period with included first and excluded next local calendar dates,
an IANA timezone, exact UTC due instant and evidence. Calendar boundaries are
converted with Temporal, including daylight-saving transitions; skipped dates
are rejected. Registration/obligation coverage must contain the entire period.
A timing correction creates an explicit successor period with the same obligation
and coverage boundaries plus new due/reminder evidence. The old period/report
remains immutable and superseded; preparation must target the successor. Old
reminders cannot send, and genuinely new configured stages have new source IDs.
Overlaps for the same obligation or mode/jurisdiction/registration are rejected
across obligation references. Dates never infer a legal filing/payment interval.

## Frozen evidence and arithmetic

Preparation reads the **complete retained applicable population**, without a UI
history limit. All canonical subscription periods and seller invoices are eligible,
including separately invoiced delta charges and replacement renewals. No
initial/renewal-only filter is used. The narrow `tax_reporting_sources(uuid)`
helper checks current global tax authority, resolves the saved obligation scope,
and projects selected original document, captured-charge and confirmed financial
effect fields. It does not grant raw financial-ledger or merchant-review access.

Invoice components are positive; linked permanent credit components are negative.
Original line rule revision, treatment, jurisdiction, registration and exact
component amounts are retained. Credits use their issued cumulative original
allocation. Current rates, buyer edits, gross-minus-cash arithmetic, bank settlement
and planning FX never recalculate liability. A credit belongs to its own issue
period; an original invoice outside that period remains contextual evidence.

Each source retains its document/period/Business/native-payment identity, original
link, issue date, inclusion/exclusion reason and artifact state. Captures represented
by invoices are explicit excluded coverage records, preventing double inclusion.
Missing capture dates remain review gates. A permanent number remains an issued
source even when artifact bytes are failed/pending; an attributable evidence
resolution can acknowledge that limitation without claiming the bytes exist.

Confirmed `financial_effect` retains actual cash (including earlier confirmations linked to period credits), native/source identity, original
tax and allocation, approved credit, linked permanent credit and uncredited
difference. Only the linked permanent credit affects the tax aggregate. Actual
refund cash is never subtracted twice, and a rounding residual is not classified
as tax, fee or FX. Pending requests/disputes are not confirmed cash or credits.
Confirmed credit-applicable effects without a permanent credit block approval.

Totals are exact signed decimal minor-unit strings. Collected tax is separate from
net revenue and gross document amounts. Currency/registration mismatches and late
sources after the explicit cutoff create required issues; missing coverage is
distinguished from a complete retained zero population. Reporting-currency
conversion is intentionally gated: this feature supplies no approved filing FX
adapter/rule. Resolve the actual supported original-currency obligation or supply a
separately implemented, reviewed reporting conversion; bank/planning FX cannot
waive the gate.

## Review and stable contract for #52

Every preparation is an immutable `tax_liability_report` revision. `id`, `periodId`,
`revision`, `digest`, original `snapshot`, underlying source IDs and original actors
remain stable. `digestAlgorithm=sha256_sorted_json_v1`: normalize dates as JSON,
recursively sort object keys by JavaScript string order, retain array order, encode
compact JSON as UTF-8, then SHA-256. The digest covers the frozen snapshot; action
history and current status are separate. Identical evidence can have the same
digest in two distinct report revisions.

`createTaxPeriodApplication().report(credentials, reportId)` returns the historical
snapshot, current/superseded state, unresolved issues and attributed actions. The
snapshot's obligation contains the configured preparer/reviewer IDs and distinct
review policy. Approval requires a current permitted reviewer, no unresolved
required issue, matching source/configuration fingerprints and the latest report.
Distinct people are enforced only when configured. Review, issue creation,
resolution and approval are separate actions. A concern raised after approval
requires resolution and a new approval. UUID retries bind original actor and exact
payload; another authorized actor uses a new action/key. Expected versions and the
shared database lock serialize preparation/review/configuration races.

Six source-table triggers serialize relevant source changes with report commands
and append an explicit `invalidated` action: seller documents/artifact state,
captured periods, confirmed financial effects, obligation revisions/decisions and explicit timing successors.
Source changes outside the period/jurisdiction do not rewrite the earlier report.
A successor is explicit. Source/configuration fingerprints are also checked on
reads, review and exports. Export rechecks current session/MFA and tax authority
after reading sensitive data. It returns approved JSON with the stable IDs and
snapshot; no provider/native authentication material or lease is included.

**Preparation, review, approval and export all retain `filed=false`, `paid=false`.**
These describe this workflow's lack of submission/payment confirmation. #52 must
keep actual evidence-backed submission/remittance records separately and recheck
the current approved report/reviewer authority before its own action. No tax
authority endpoint, filing or payment action is implemented here.

## Durable reminders and separate email

Each period has zero or more explicitly configured unique stage labels and UTC
instants. Empty configuration means no reminder, rather than an invented interval.
`tax_period_reminder` persists each stage once. Repeated evaluations/restarts cannot
repeat a stage. A current approved obligation, full period coverage, original
approver's current tax grant and enrolled factor are required. Ending sales
coverage does not erase reminders for a covered historical report. The evaluator
uses the supplied application clock capped by database time; expiry/technical
notification windows use trusted database time.

Deploy `recover-tax-period-reminders` with an explicitly chosen
`TRIGGER_TAX_PERIOD_REMINDER_CRON`. The task calls the same persisted evaluator as
the public manual check, retries through Trigger and returns only a created count.
It performs no external delivery. A non-tax actor cannot gain global due-work
authority by clearing Business scope. The anonymous server worker can only produce
genuine currently configured idempotent stages, without choosing recipients/body.

Optional `tax_period` transactional email uses #59's existing separately deployed
recovery, sender/domain/account/terms/quota/key-ring and native acceptance/delivery
pipeline. The operator opts in for their own verified account. Current tax rights,
enrolled MFA, configured preparer/reviewer audience and preference are rechecked;
Business audiences are denied. The source is the persisted reminder UUID and its
exact report/action/configuration stage. Later review/preparation/configuration or
a later configured stage supersedes it. A new cron tick is not a new notice. Global
purpose/source locking and cross-account rebinding refusal remain in common
`notification_enqueue`. No arbitrary recipient/body API exists. In-app availability
does not imply email acceptance or delivery.

## Persistence and operations

Six new append-only, forced-RLS ledgers: `tax_obligation_revision`,
`tax_obligation_decision`, `tax_reporting_period`, `tax_liability_report`,
`tax_report_action`, `tax_period_reminder`. Runtime SELECT and INSERT are verified
individually, with no UPDATE/DELETE/TRUNCATE or column-update privileges. Reminder
INSERT is helper-only. All eleven new foreign keys reference stable primary keys;
there are no new composite FKs depending on replaceable Drizzle UNIQUEs. Existing
managed scopes still participate in the full prepare/Drizzle/secure cycle.

Five runtime helpers: `tax_reporting_operator()`, `tax_reporting_sources(uuid)`,
`tax_reporting_people()`, `tax_reporting_due(timestamptz)`,
`tax_reminder_visible(uuid)`. Two private functions: `tax_reporting_changed()` and
`tax_reminder_current(uuid)`. Definers have empty fixed search paths, no PUBLIC
execute, no owner-role membership for runtime and explicit required grants.
Startup verification checks every ledger, eleven validated FKs, eighteen policies,
six source trigger bindings, required helper grants and private/default-PUBLIC
denials. Prepare pauses new raw ledger writes; secure restores them. Histories
have no invented automatic legal purge period.

Actual #54 tax effort/administration/filing expense is entered through the existing
evidenced cost workflow with explicit source, amount/unit/currency. No elapsed-time
effort, hourly rate, filing expense or duplicate collection tax is generated here.

The application's real provider/account/legal configuration, actual database
application/reapplication, deployed Trigger cadence and transactional mail setup
remain operational inputs. User UI and live provider/filing/payment acceptance are
separate from disposable PostgreSQL application tests.
