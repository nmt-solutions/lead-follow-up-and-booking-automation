## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

Owners and admins manage invitations and team access while salespeople and platform operators receive only their intended capabilities.

## Acceptance criteria

- [ ] Invite, accept, expire/revoke an invitation, change a role and remove membership through persisted UI/API flows; test notification effects deterministically.
- [ ] Enforce Owner/Admin/Salesperson permissions on server commands and queries, including billing, integrations and commercial authority.
- [ ] Separate platform-operator capabilities from ordinary Business administration; prevent cross-Business access and accidental privilege escalation.
- [ ] Revalidate membership on subsequent requests and queued actions after revocation; retain an authorized audit trail.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 13, 118, 143.
Source #1 acceptance scenarios: 5, 38.

<!-- ticket-plan: full-product-2026-11-05:T02 -->
