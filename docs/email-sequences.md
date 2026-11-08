# Approved email sequence execution

Read this when changing campaign execution, sending adapters, mailbox correlation or sequence recovery. #34 consumes #32's immutable approval inspection and the shared sender, eligibility and Opportunity controls. Trigger.dev owns durable timing and recovery; PostgreSQL owns current authorization, reservations and action identity.

## Commands and state

The campaign page separates approval, own-client handoff and sequence execution. Approval creates no jobs. Start persists the exact approved steps and a Prospect Opportunity for each selected recipient, then submits only the due initial steps. An Opportunity has no buyer or inquiry intake until an actual qualifying incoming message is captured.

The approved version includes an optional IANA time zone, weekdays and same-day local send window. An older approval without a window remains usable for manual handoff; automated execution requires a newly reviewed version with timing. Delays are minimum elapsed minutes after actual provider acceptance. The next eligible local window supplies the due time. DST uses Temporal's compatible interpretation: first repeated start, missing start advanced by its gap. Execution outside a window reschedules; subsequent steps use actual acceptance time, so overdue work cannot catch up several reminders at once.

Pause is reversible; Cancel permanently stops unstarted steps. Queue cancellation is best effort because workers recheck persisted state. Already started provider effects remain accountable. Human takeover pauses only the affected Opportunity across channels. After explicit handback, Recheck and resume binds eligible work to its current owner, session and control version. Other recipients retain their own worker identity. Stale job generations fail closed.

Run control state and progress are distinct: an enabled run can be awaiting reconciliation or need review. Individual steps show exact content, due time, queue state, reserved attempts, blocking reasons and receipts. Recovery records the requesting actor and reason. Prepared, provider acceptance, native Sent-folder observation and reply observation retain separate meanings. None establishes delivery or a sale.

## Dispatch boundary

Each queued capability contains Business, run, action, generation, execution key and actor/session identity. The worker validates it against persistence under Business scope. It consumes the exact campaign revision, recipient, address and step through the campaign inspection contract. Content and recipients are never regenerated from later discovery.

Immediately before the adapter call, the worker checks current ownership/control generation, any reply, effective suppression, authorizing sessions/MFA/memberships, approval and authority versions, recipient/source evidence, selected sender and reply bindings, sender health, complete current reply visibility, reach, purpose-specific eligibility, allowance period and pacing. Initial outreach and its unanswered reminders retain prospect-specific permission evidence; an Opportunity-specific suppression also applies to their persisted Opportunity. Existing inquiry/RFQ dispatch retains its original purpose and reach semantics.

As in #19/#31, one bounded external call holds the Business and email-policy locks. This reviewed exception to the usual external-I/O boundary ensures a restriction committed first prevents the stale effect. It serializes dispatch within one Business. A later restriction cannot undo an external effect that already started. Adapters must honor cancellation and perform one transport call, with internal SDK/network retries disabled.

## Attempt and recovery contract

Before a provider call, a committed reservation records an attempt ID, the exact envelope and adapter identity. It consumes the recipient's approved cap and the Business's explicitly configured period allowance. Rejections, throttles, crashes and unknown outcomes never silently refund it. A known Retry-After can schedule another attempt of the same approved step within the remaining cap, allowance, local window and pacing. This can consume the capacity otherwise available for a later reminder.

Only the invocation that creates a reservation can start its send. Re-entry after that commit reconciles the original attempt; it cannot start that transport call again. A crash before reservation commit leaves pending work recoverable. A crash after it, even before the adapter starts, leaves unconfirmed work. A provider acceptance followed by a failed database commit is reconciled against the same persisted attempt.

The sending adapter returns validated accepted, definitively not-accepted, or unknown outcomes. Its reconciliation method is read-only and must distinguish authoritative non-acceptance from an incomplete lookup. Message-ID is a correlation reference, never a claim that Gmail or Graph deduplicates sends. A timeout, malformed response or empty search result remains unknown. A changed adapter cannot reconcile an old adapter's attempt. Gmail can account for acceptance from an exact, current authorized Sent observation; the receipt explicitly records `sent_folder` evidence, separately from `provider_response`. Neither proves delivery. Weak evidence from own-client handoffs remains separate and blocks conflicting automatic preparation for that version.

Native mail processing recognizes exact reserved outgoing references and expected participants within the selected mailbox's current authorized scope. It can retain the original attempt's Sent-folder or reply evidence even when acceptance is unknown. General mailbox completeness remains distinct from the supported Gmail sequence reply contract described in [Gmail operations](gmail.md#approved-gmail-sequence-sending). Exact opt-outs can be captured before the first incoming inquiry exists. Original inquiry intake ownership stays immutable; the database permits only the first evidence-backed binding of a Prospect Opportunity to its received buyer.

Reply correlation uses the exact outgoing reference and expected participants/reply route. Mailbox-local thread IDs are retained as provenance; sending and reply mailboxes can assign different thread IDs. Generic native sequence replies are retained for human review and stop the sequence. They are promoted to an inquiry only with an explicit qualifying inquiry or buying-interest classification; text such as "Wrong person" establishes no engagement.

The sequence history shows the exact captured reply. An Owner/Admin with current mailbox review scope can record it as a qualifying inquiry or another reply, with an attributed reason. Qualifying review feeds the existing inquiry intake for the same Opportunity; other replies remain correspondence without an engaged buyer. Classification sends no mail and grants no outbound authority. Its evidence is immutable and retries return the same decision.

## Production readiness and operations

Production web and Trigger composition select the native Gmail adapter when approved Gmail configuration exists. Every execution still requires independent send consent, current identity/reply checks and the explicitly configured `gmail-sequence-v1` live allowance. Other sending providers remain unavailable here. There is no fixture, Resend or other hidden delivery fallback. Deterministic application tests inject HTTP/provider fixtures, policies, permissions, limits and time.

Queue readiness requires Trigger credentials/project, explicit worker deployment confirmation and an operator-selected recovery cron. The configuration names are in `.env.example`. Delayed task submission uses stable action/generation idempotency keys; database guards remain authoritative after Trigger's key retention expires. Trigger retries infrastructure failures against persisted state without multiplying the approved transport attempts. An operator-configured recovery task drains pending queue submissions and reconciles committed/unknown attempts. It does not use web-process timers or an application cron loop. The per-call deadline bounds I/O only.

The worker uses the installed SDK's supported [delayed triggering](https://trigger.dev/docs/triggering#delay) and [task retry](https://trigger.dev/docs/errors-retrying) contracts.

When reviewing a stalled sequence:

1. Inspect its exact version, recipient, Opportunity, action history and queue state.
2. Restore current policy, sender/reply visibility, ownership and an authorized allowance where appropriate. A changed immutable plan needs a new approval.
3. Reconcile unknown acceptance using authoritative provider evidence. Preserve uncertainty when evidence is unavailable.
4. Use Reconcile and recover queue for failed submissions. Use explicit handback and Recheck and resume for paused unstarted work. Cancel work that should stop; retain sent and unknown history.

The real-persistence tests in `tests/email-sequences.test.ts` exercise application commands, deterministic transport effects, worker restart, queue loss, concurrent deliveries, local timing/DST, reservation/receipt failures and PostgreSQL barriers at the concrete dispatch boundary. Browser/UI validation and human acceptance are user-owned. No live campaign, worker deployment or existing real job is launched by this implementation.
