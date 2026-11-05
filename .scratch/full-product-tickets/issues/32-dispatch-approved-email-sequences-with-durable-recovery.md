## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An approved email sequence runs on schedule and stops safely on replies, opt-outs, takeover or lost readiness.

## Acceptance criteria

- [ ] Use durable Trigger jobs with local timing, attempt caps and stop conditions; execute only the currently approved immutable recipients/messages.
- [ ] Immediately before dispatch recheck ownership, replies, suppression, authority, identity/health, reply visibility, reach and allowances.
- [ ] Persist action identity and delivery evidence; handle crashes, retries and ambiguous provider acceptance with reconciliation rather than blind resend.
- [ ] A reply just before the due reminder cancels the unanswered sequence; manual takeover pauses only its Opportunity across channels until explicit handback.
- [ ] Complete the flow with deterministic mail adapters independently of live Gmail/Graph approvals, while enforcing honest production adapter readiness.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 42, 45, 46, 47, 48, 49, 50, 64, 65, 66, 82, 86, 112, 114, 115, 120.
Source #1 acceptance scenarios: 8, 10, 11, 12, 17, 18, 22, 23.

<!-- ticket-plan: full-product-2026-11-05:T32 -->
