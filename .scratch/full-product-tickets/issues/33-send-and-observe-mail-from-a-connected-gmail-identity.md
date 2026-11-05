## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

Approved application actions send from the Business's Gmail account and display honest provider/sent-folder evidence.

## Acceptance criteria

- [ ] Require separate sending authorization, current identity/reply readiness and the shared dispatch eligibility policy.
- [ ] Send only an authorized action through the native Gmail adapter; preserve Business/thread/provider identity and correlate subsequent sync observations.
- [ ] Distinguish accepted send, Sent-folder observation and delivery evidence; handle token loss, limits and ambiguous provider acceptance without blind resend.
- [ ] Use focused payload/grant fixtures and the existing application contract; adding sending does not expand mailbox processing scope or history access.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 45, 50, 67, 71, 72, 74, 75, 76, 80, 81, 86, 114.
Source #1 acceptance scenarios: 10, 12, 19, 20, 23.

<!-- ticket-plan: full-product-2026-11-05:T33 -->
