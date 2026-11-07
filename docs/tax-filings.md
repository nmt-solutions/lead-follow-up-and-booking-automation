# Tax filing and remittance confirmations

The supported adapter is `manual_evidence_v1`. It records an authorized person's
external work and an independent review of retained originals. It does **not**
call an authority or bank API, verify portal content natively, move money, or turn
fixture success into production verification. Unknown procedures remain unavailable.

Use `/platform/tax/periods` for liability preparation and
`/platform/tax/filings` for the separate confirmation workflow. The public seam is
`createTaxFilingApplication`; the bounded same-origin API is
`/api/platform/tax/filings`, with separate export and original-content routes.

## Authority and configuration

Global filing records require a provisioned `tax` platform operator and fresh
central operator MFA. Business membership, documents, refunds, reconciliation and
notification administration do not grant tax authority. Configuration and review
use the current obligation's assigned reviewers. An independent confirmation must
come from a reviewer other than both the work-order initiator and original file
recorder. Another operator uses a new attributable action UUID; they cannot adopt
the original actor's request UUID.

Supply the actual reviewed jurisdiction, registration, mode, reporting currency,
local inclusive/exclusive dates, cutoff and due stages through #51. Then configure
the supported manual return type, authority account, remitting account, effective
window, preservation/hold policy reference and explicit filing/payment requirements.
Approve the exact procedure revision. No jurisdiction, deadline, filing contract,
currency conversion, bank connector, legal exemption or retention period is seeded.

Later procedure revisions and decisions append report invalidation. Prepare and
approve an explicit successor report; the original snapshot and approval history
remain intact. A change to actual invoice/credit/cash context follows #51's source
invalidation and timing-successor rules. An unchanged digest is insufficient:
report ID, period ID, revision, digest and original approval ID must all match.
The canonical digest is the original `sha256_sorted_json_v1` implementation shared
with #51, not a second serialization algorithm.

## Manual workflow

1. Prepare/review the complete original invoice and permanent credit evidence in
   #51. Required issues block approval. Export the exact current approved report
   if required for accounting or external preparation. `tax_accounting_filing_v1`
   contains the frozen report, source IDs, preparer/reviewer identities and export
   attribution. It is not a jurisdiction-specific return format, receipt or payment.
2. Save a submission or remittance work order against that exact report and
   approved procedure. The original actor, UUID, payload, accounts, amount, report,
   policy decision and approval remain immutable. Confirmed-state context is
   frozen too. A reviewer approves the displayed current context; intervening
   evidence causes a conflict and requires refresh/review before new authorization.
3. An authorized person performs the approved external step manually. Record its
   original reference, time and pending/unknown/failed outcome. The application
   performs no corresponding external mutation. A work order can record only one
   initiation. Resolving an issue does not authorize another initiation.
4. Retain the original authority/bank file, actual provenance, reference, time,
   amount and exact scope. Supported originals are UTF-8 text, PDF, PNG and JPEG,
   up to 2 MiB. Actual bytes, type signature, byte count and server-checked SHA-256
   are retained unchanged. An unknown scope may be null; other original currencies
   can remain unmatched. No conversion is inferred. A reference or amount alone
   cannot match another account, obligation, period or revision.
5. Record an acknowledgement separately. Accepted-for-processing is not final
   filing; initiation, processed provider settlement or a generic failure is not
   settled tax remittance. The assigned independent reviewer inspects the original
   bytes and exact account/registration/period/revision/currency/amount before
   recording a final filing or settled-remittance confirmation. These remain
   **operator-entered evidence and operator review**, not native verification.
6. Uncertain work stays under its original identity. Only conclusive original
   no-submission/no-transfer evidence and independent review can append a
   supersession. A replacement has a new authorization and explicit `supersedesId`.
   A generic failure cannot do this. Previously confirmed facts cannot be
   superseded away. Late contradictory facts can still be retained and reviewed;
   they never silently repeat money or erase a later confirmation.

No-effect evidence must cover the attempt and all recorded acknowledgements in
time; an earlier account statement cannot resolve a later initiation. A late
matching final filing or settlement acknowledgement blocks its replacement even
after independent issue review. Confirm the original fact under its original
identity instead. Current assigned report/procedure reviewers and the procedure's
effective window are checked again after serialization and when new authorization
is inserted.

Original files are deliberately global private tax storage in PostgreSQL. They do
not use an arbitrary customer's file ownership or accept a storage URL/key. The
logical object is the private byte-ledger row plus evidence UUID and SHA-256;
metadata also retains its original database provenance. Download access is internal,
actor/session-bound and expires after 30 seconds of trusted database time. The
application rechecks current session, factor, MFA, tax authority, expiry and bytes
after I/O. It returns an attachment, not a bearer storage URL or private capability.

## Reconciliation and amendments

Confirmed remittance allocation is appended exactly once per intent, confirmation,
original evidence and account/reference identity. Filing alone never implies paid.
Partial, unallocated, overpaid and unsupported-currency amounts remain explicit.
An overpayment/difference is not fabricated into a fee, tax credit or FX adjustment.

`filed` reports retained confirmed filing facts; `currentRevisionFiled` separately
identifies the current approved revision. A source correction preserves the old
acknowledgement and requires explicit amendment lineage. Original actual payments
remain historical and unallocated to a successor until a reviewer explicitly
reconciles the same allocation to an exact current approved report/policy/action.
This appends a review; it creates no second payment and changes no original row.
Registration, jurisdiction, coverage, currency, mode, accounts and return type must
match. Wrong-account/currency or otherwise unsupported reuse remains unavailable.

Original issued components, actual cash `1100`, permanent original-tax credit
`1099` and unclassified residual `1` remain distinct. Pending refunds/disputes do
not create a tax credit. Collected tax is not revenue or operating margin.

Fulfillment uses only the approved procedure's explicit requirements, an exact
current reviewed report and reconciled facts without unresolved differences.
Zero liability does not prove a required return was filed. A configured reviewed
non-requirement does not manufacture a filing or payment fact. The original #51
report always retains preparation-only `filed=false` and `paid=false`; period
views compose actual confirmation state separately.

In-app reminders retain #51's once-per-period/stage identities, timing successors
and current-source guards. Partial remittance leaves requirements due. Completed
configured requirements suppress current reminders and typed #59 mail sources.
Required unresolved issues on an earlier report for the same obligation and
coverage keep those requirements due after amendment or payment carry-forward.
Mail acceptance/delivery remain separate from in-app and filing/payment truth;
current verified self-preferences and tax audience rights still apply. Tax authority
does not grant notification administration.

## Administration expense

Actual preparation/filing expense uses a **supporting expense original**, explicit
amount/currency/time, measured quantity/unit and funding. It additionally requires
current `costs` authority and MFA. One stable
`evidence:tax_filing:<evidence UUID>` identity is recorded through #54's cost model;
exact original actor/payload replay does not duplicate it. No hourly price or
duration is invented. Direct bank-remittance/authority-confirmation artifacts
cannot be expensed as administration, and remitted collected tax is never inserted
as operating cost. INR/USD are the supported cost currencies; unsupported original
currency remains evidence, without an invented conversion.

## Persistence, retention and recovery

Ten append-only forced-RLS ledgers are registered in Drizzle and prepare/secure:
`tax_filing_export`, `tax_filing_policy`, `tax_filing_policy_decision`,
`tax_filing_intent`, `tax_filing_event`, `tax_filing_evidence`, `tax_filing_bytes`,
`tax_filing_access`, `tax_remittance_allocation`, `tax_remittance_review`.
The byte ledger has no raw runtime privileges. Other ledgers require SELECT and
INSERT separately, without runtime mutation/deletion privileges. Thirty-one FKs
reference stable primary keys; no new FK targets a replaceable Drizzle UNIQUE.

Three operational and three private SECURITY DEFINER functions have empty search
paths and no PUBLIC execution. Five insert guards bind originals, approvals,
lineage, confirmations and allocations, and derive access expiry from database
time. Startup also rejects implicit default PUBLIC ACLs, missing individual grants,
owner runtime, unsafe policies and missing scope guards. #49 raw financial
ledgers stay private. The only old SQL body extensions are `tax_reporting_due`
and `tax_reminder_current`; #47/#49/#56 and the seven final #51 notification
extensions remain intact.

Protected history and its explicit policy/holds survive completion and #56
customer offboarding. No automatic disposal or legal retention period is invented.
Customer #56 exports do not grant access to these global records. #58 infrastructure
backups must retain the original byte ledger, metadata, approvals, allocation and
replay/lineage history with the report/tax sources. Restored work stays quarantined
under that workflow; old sessions/grants are not renewed. Current authority and
fresh actor-bound access are required after recovery.

Manual evidence and its bytes commit atomically; there is no external filing or
bank job to retry automatically. Factual recovery can use a new current authorized
reviewer after the initiating session becomes obsolete, retaining the original
revision even after correction. Trigger remains responsible for #51 due jobs and
#59 notification recovery. Effect remains discovery-only.

Run full configured `pnpm db-push` only through the assigned deployment owner.
The isolated tests exercise populated FULL prepare/Drizzle/secure reapplication,
preserving original row/content fingerprints, constraints, helper bodies, original
bytes and public filing/remittance histories. They are not actual-target rollout
or live authority/bank verification.

## User acceptance

Provision current tax/reviewer authority, configure genuine legal/procedure inputs,
review and export an approved period, then follow the separate manual approval,
attempt, original-file, acknowledgement and independent-confirmation steps. Expect
an unknown attempt and a processing-only message to remain incomplete; expect
partial payment to leave a residual; expect a later credit to require amendment
without rewriting the old filing. Refresh after source/policy changes and verify
the original private download, scope denials and separate actual expense.

The user validates rendering, keyboard/focus, compact/wide layouts, enlarged text,
appearances, accessible feedback and MFA/session recovery. Actual legal scope,
external filing/payment execution, independent review, actual-target application,
deployment/Trigger cadence and live acceptance remain explicit parent/user work.
