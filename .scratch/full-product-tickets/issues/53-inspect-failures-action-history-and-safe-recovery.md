## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

Authorized users inspect failed runs/actions, understand their policy context and recover safe work without duplicate external effects.

## Acceptance criteria

- [ ] Provide Business-scoped action/history and separate operator run/queue/channel/health views with sources, approval/authority context, blocked reasons and responsible next actions.
- [ ] Redact credentials and private payloads, apply configured diagnostic/audit retention and link useful provider-native logs without adding another observability subscription.
- [ ] Expose retry/reconcile/escalate controls that honor current authority, ownership, budget and idempotency; ambiguous sends or bookings cannot be blindly replayed.
- [ ] Recover a failed run/connection fixture and verify correct progress, alert ownership and preserved history after a worker restart.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 50, 63, 84, 109, 112, 114, 115, 116, 119, 121, 147.
Source #1 acceptance scenarios: 8, 10, 12, 18, 22, 28, 30, 41.

<!-- ticket-plan: full-product-2026-11-05:T53 -->
