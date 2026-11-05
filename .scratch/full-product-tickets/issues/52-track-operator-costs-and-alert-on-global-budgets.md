## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

An operator sees cross-provider spend and a month-end forecast with configurable global/category alerts.

## Acceptance criteria

- [ ] Track fixed commitments, metered hosting/database/worker usage, AI/search/tools, payment/provisioning and recorded setup/support/sales effort with explicit source, allocation and freshness.
- [ ] Separate OpenAI credits and existing subscription allocation, BYOK provider spend, Gateway prepaid cash/consumption/fallback and customer-paid Meta charges without double counting.
- [ ] Configure global/category monthly budgets and default alert thresholds at 80/90/100 percent; show forecast assumptions and deduplicate notifications.
- [ ] Keep global budget reporting separate from per-run authorization and extra-spend approvals; missing rates/budgets are explicit rather than invented caps or free usage.
- [ ] Record selected-plan cost changes and unpriced items, retaining INR planning conversion as a labeled assumption rather than customer billing/actual FX.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 23, 102, 117, 119, 125, 130, 144, 145, 147.
Source #1 acceptance scenarios: 7, 29, 30, 36, 39, 41.

<!-- ticket-plan: full-product-2026-11-05:T52 -->
