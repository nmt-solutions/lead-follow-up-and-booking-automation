# Subscription money reconciliation

Issue #50 uses **authorized manual evidence entry**. It makes no settlement API,
bank API, payment, refund or remittance call. `/platform/reconciliation` is available
only to a provisioned current `reconciliation` operator with central MFA. Business
membership, tax, documents, refunds, costs and customer export permissions do not
grant this global access.

An entry is an **operator assertion**, including when the retained original is an
authoritative provider or bank statement. The app validates its links and arithmetic;
it does not authenticate statement contents or claim native bank verification.

## Executable workflow

1. Select a UTC report period (inclusive start, exclusive end, at most 366 days).
   Original charge totals use capture time. Active settlements use their observation
   time. All retained receipts for those settlements are included regardless of their
   observation period. Lifetime actual financial effects and permanent credits for
   the original charge cohort are explicitly labelled, not represented as period tax
   filings. Original sources outside the charge cohort remain available when linked
   to a selected settlement.
2. Retain the exact original provider statement, independent bank statement or
   authoritative conversion confirmation. Upload PDF, text or CSV up to 256 KiB.
   The server computes SHA-256 and retains the original bytes, reference, actor,
   database receipt time and immutable PostgreSQL storage identity. Unsupported or
   oversized evidence is refused. Use masked bank account references in entries.
3. Record the native settlement identity, canonical provider account/mode, source
   period, currency/precision, authoritative debit/credit totals, transfer amount,
   status, transfer time, UTR/reference and masked destination. Add each captured
   charge or actual refund/dispute effect using the original source selector.
   Unknown statement movements can be retained as unclassified, without spoofed
   payment/Business links; they remain unresolved.
4. Record each independently observed bank credit with its unique transaction ID,
   retained source, actual currency/amount, account, UTR and value time. Multiple
   partial credits may match one settlement. Equal amounts alone never match.
   Provider/account/mode, currency/precision, masked account, UTR and a compatible
   value date/time must also support the link. A date-only statement retains its
   date precision; the app does not invent a bank timestamp. Wrong/missing/duplicate
   evidence remains visible.
5. Acknowledge a discrepancy with a reason and supporting evidence. This retains
   its original expected/observed/difference snapshot. A balanced review is accepted
   only for the exact current digest with no unresolved differences. It remains an
   operator assertion. New evidence invalidates the previous digest's resolution.
6. Prepare a correction from retained history. It appends a same-identity successor;
   the original evidence and reviews remain. A complete correction may explicitly
   supersede additional retained copies of that same identity. Concurrent successor
   attempts conflict.
   Independent contradictory copies remain visible as duplicate identities and are
   excluded from authoritative aggregate totals. They cannot be acknowledged into
   a balancing fee, tax or FX adjustment.
7. Download the accounting JSON export. It includes the complete cohort, original
   source IDs and tax components, invoice/credit numbers and hashes, expected and
   observed totals grouped by provider/account/mode/currency, exact differences,
   coverage gaps, linked originals, correction history, every retained review and
   evidence hash/storage identity. It is not derived from a UI page. Original private
   bytes require a separate current role-bound expiring download.

## Financial semantics

- Immutable `subscription_period.snapshot` and `.charge` are the charge authority,
  including initial, replacement/renewal and prorated delta/standalone-order rows.
  Native invoice ID may legitimately be null for a standalone order. Links retain
  Business, action/period, provider/account/mode, native customer/subscription,
  payment/invoice/order, quote, tax calculation and original tax components.
- Original invoice/credit totals and artifacts are never recomputed from current
  profiles, rules or plans. A missing seller invoice is explicit coverage, not a
  manufactured document. Gross, sales tax and revenue remain separate.
- Actual refunds and dispute deductions come only from immutable `financial_effect`
  events. Requested/pending/unknown outcomes and permanent credits alone do not
  establish cash movement. Actual cash, original-tax credits and any uncredited
  difference stay distinct. A cash 1,100 / credit 1,099 / residual 1 never becomes
  another refund, fee, tax or FX amount.
- Provider debit minus credit presentation is retained as separate debit and credit
  fields; the report uses **credits minus debits** for net received. Compared values
  remain in their original minor units. Differences use observed minus expected.
- A row's fee presentation explicitly states whether tax is included. Inclusive fee
  25 with fee tax 3 costs 22 plus tax 3, deducting 25 once. Exclusive fee 22 plus tax
  3 also deducts 25 once. Fee tax is never subscription sales tax.
- Aggregate fee coverage and its included transaction lines are alternatives. The
  selected coverage is deducted once and overlapping presentations are compared.
  A zero settlement aggregate cannot erase a known native capture processing fee.
  Missing or contradictory actual fee evidence stays unavailable/review.
- Original INR/USD transaction currencies and precision 2 are retained. This is the
  explicitly supported initial billing scope, not a worldwide currency/accounting
  rule. Mixed currencies are never summed.
- A native captured `base_amount`/`base_currency` can establish that capture's actual
  conversion. A refund does not inherit it. Other conversion requires retained
  authoritative evidence with explicit target-minor/source-minor numerator and
  denominator, effective timestamp, original rounding and reference. Arithmetic is
  exact integer/rational arithmetic. A mismatch is unresolved; planning FX is unused.
- Provider `processed` indicates transfer initiation, not independently observed
  bank credit. Partial receipts and unknown bank evidence do not become zero.
- Customer-paid Meta charges are absent: the source reader joins only canonical
  subscription periods, original seller documents and native financial effects.
  This workflow writes no #54 expense or commitment, preventing duplicate native
  fee attribution. Tax-period reporting FX and filing/remittance (#51/#52) remain
  separate configured sources, not inferred from bank reconciliation status.

## Persistence, authorization and recovery

Four append-only tables store evidence, records, reviews and access grants. Their
runtime role is nonowner, forced-RLS and requires SELECT and INSERT separately.
No UPDATE/DELETE/TRUNCATE or mutable evidence/history column is granted. The narrow
global `reconciliation_sources` helper requires current reconciliation authority
and empty Business scope; it exposes original financial facts without provider
merchant reviews, callbacks, native credentials or worker capabilities. The private
trigger helper validates canonical links and derives grant expiry from database
time. Both use fixed empty search paths and reject PUBLIC execution, including
implicit default ACLs. No new operator capability or durable job is needed.

Every original UUID retry binds actor and exact payload. A different current
operator uses a new attributable request. Current MFA/authority is checked around
persistence reads and immediately before sensitive returns. Review comparisons and
writes serialize under one transaction; stale digests cannot resolve a newer state.
Sensitive evidence access uses a hashed random 60-second grant, current role/MFA,
database expiry and a post-read authorization check. Tokens travel only in bounded
same-origin POST bodies; responses are private/no-store attachments.

Evidence bytes and replay/history identities have no generic cleanup route. They
remain protected financial supporting evidence under #56 holds/preservation; no
new deletion or legal retention default is invented. #58 infrastructure recovery
must retain these four tables and original bytes/hashes, reapply both helpers and
forced-RLS/grants, and preserve corrections/request tombstones. Expired grants stay
expired and every future access still requires a current session/capability. This
feature creates no provider callback, worker, lease or queued payment effect that
a restored purchaser session can replay.

## Primary provider references

Checked 2026-11-07. These define the interpreted evidence semantics; this feature
does not implement or claim live execution of the endpoints.

- [Payment entity](https://razorpay.com/docs/api/payments/entity): native fee includes
  GST; captured payment identity and actual fields remain distinct from settlement.
- [Settlement entity](https://razorpay.com/docs/api/settlements/entity): settlement
  amount, status, fees/tax and UTR; normal settlement fee/tax can be zero.
- [Settlement webhook semantics](https://razorpay.com/docs/webhooks/settlements):
  processed confirms initiation, not bank credit; use the UTR with bank statements.
- [Currency conversion](https://razorpay.com/docs/payments/international-payments/currency-conversion):
  original amount/currency and actual native base amount/currency have different
  roles. Conversion uses the payment-time processing-bank rate under that path.

Actual provider/bank statement acquisition, legal/accounting approval, operator
provisioning, configured target application/reapplication and user-rendered UI
acceptance remain operational gates. No live provider/customer/bank action or
automated banking claim is made.
