## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An operator previews approved extraction or drafting tasks, switches a validated model profile and sees provider/fallback consumption.

## Acceptance criteria

- [ ] Use Vercel AI SDK and AI Gateway with central task/model profiles, approved provider allowlists, output schema/capability checks and explicit numeric limits.
- [ ] Use operator-owned API credentials only; keep linked OpenAI API credits, existing subscription allocation and Gateway credit/fallback charges distinct.
- [ ] Bound the approved system-key fallback and combined retries; missing credentials, funding, model settings or allowance remain visible setup states.
- [ ] Record usage provenance/latency and validate representative extraction/drafting outputs before profile changes; a model change does not replace Exa or alter source rights.
- [ ] Run a persisted model-profile preview against reviewed Business/sample inputs without sending a message; validate its output and treat input/model instructions as untrusted data. Later discovery and inquiry workflows consume the same approved profiles.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 18, 23, 39, 110, 111, 117, 119, 125, 130, 147.
Source #1 acceptance scenarios: 7, 28, 29, 40, 41.

<!-- ticket-plan: full-product-2026-11-05:T13 -->
