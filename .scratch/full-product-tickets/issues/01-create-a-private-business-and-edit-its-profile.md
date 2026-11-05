## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An owner can sign in, create a Business, save its profile and return to the same isolated records.

## Acceptance criteria

- [ ] Bootstrap the selected Next.js, Better Auth, Neon, Drizzle/pg and Tailwind/shadcn stack only as needed for this complete first flow; pin compatible versions and configure lint/Prettier scripts.
- [ ] Persist the signed-in owner, Business and editable profile; authenticate server commands and derive Business access from membership.
- [ ] Use a non-bypassed runtime database role and transaction-local Business context; another Business cannot read or update the profile through web or worker entry points.
- [ ] Establish the primary application test seam with real persistence, deterministic external adapters and a controlled clock, proving this first flow.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 1, 13, 118.
Source #1 acceptance scenarios: 1, 5, 30.

<!-- ticket-plan: full-product-2026-11-05:T01 -->
