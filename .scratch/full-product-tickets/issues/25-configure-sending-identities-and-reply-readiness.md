## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business sees whether each connected-mailbox, customer-domain or service-provided sender is eligible and ready for its intended use.

## Acceptance criteria

- [ ] Represent dedicated outreach and ordinary sales identities separately, with Business ownership, truthful identification and explicit reply routes.
- [ ] Track domain verification/SPF/DKIM/DMARC alignment separately from sending grants, inbox synchronization and reply capture.
- [ ] Require a working customer-controlled identity for first-contact prospecting; service-provided addresses remain limited to approved trial/inbound/existing-conversation use.
- [ ] An unconfigured verified-domain delivery transport or missing reply path stays not ready; do not silently use Resend for prospecting or add an unselected provider.
- [ ] Expose actionable setup/connection health and readiness from deterministic adapter fixtures without treating verification as complete two-way mail integration.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 67, 68, 69, 70, 71, 72, 73, 74, 79, 80, 81, 95, 109.
Source #1 acceptance scenarios: 19, 20, 22, 30.

<!-- ticket-plan: full-product-2026-11-05:T25 -->
