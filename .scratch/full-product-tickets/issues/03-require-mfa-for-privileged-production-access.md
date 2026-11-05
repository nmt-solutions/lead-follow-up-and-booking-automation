## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A privileged user enrolls in MFA and cannot use protected production capabilities without satisfying it.

## Acceptance criteria

- [ ] Provide enrollment, challenge, recovery and visible setup status using the minimum required Better Auth support.
- [ ] Enforce the accepted Owner/Admin MFA requirement on every enabled privileged sign-in and session path, including sensitive integration, billing and authority actions.
- [ ] Protect privileged platform operations with an explicit operator access policy; exercise recovery and revoked/insufficient sessions without bypassing Business isolation.
- [ ] Production readiness stays incomplete when required MFA is missing; unrelated optional auth plugins and enterprise SSO are not introduced.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 13, 109, 118, 121, 143.
Source #1 acceptance scenarios: 30, 38.

<!-- ticket-plan: full-product-2026-11-05:T03 -->
