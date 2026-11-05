## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

Users receive authorized authentication, invitation and platform notices through the selected transactional stream with visible delivery/setup status.

## Acceptance criteria

- [ ] Connect the transactional notification adapter to Resend and provide verified platform sender/setup status with safe, scoped notification content.
- [ ] Exercise an auth/invitation flow from user action through persisted notification attempt and delivery/result visibility, including retry and provider failure.
- [ ] Use it only for auth/platform notices; customer first-contact prospecting never enters the stream and Resend receiving quotas do not become mailbox-sync capability.
- [ ] Retain free-band volume/eligibility limits, rate handling and actual usage/cost attribution; paid upgrades require explicit selected terms rather than hidden activation.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 13, 63, 84, 109, 119, 121, 125, 136.
Source #1 acceptance scenarios: 18, 22, 30, 33, 41.

<!-- ticket-plan: full-product-2026-11-05:T57 -->
