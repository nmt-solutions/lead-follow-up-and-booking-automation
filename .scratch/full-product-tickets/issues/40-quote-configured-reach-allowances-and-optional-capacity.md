## Parent

Part of https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1

## What to build

A Business reviews a priced subscription quote for its reach and automation capacity with Meta charges disclosed separately.

## Acceptance criteria

- [ ] Let authorized operators configure explicit currency-specific prices, included discovery/automation allowances, reach and optional reserved capacity with effective versions.
- [ ] Build a reviewable quote from the Business billing profile and selected scope; absence of price/allowance configuration prevents commercial checkout.
- [ ] Disclose customer-paid Meta messaging separately without prepaid Meta credit, duplicate charging or an implied messaging guarantee.
- [ ] Show the intended billing currency and renewal terms; historical illustrative INR prices and the internal planning FX buffer are never production defaults.
- [ ] Complete the relevant persistence, application/API and UI path; verify observable state and outbound effects at the primary application seam with real internal persistence, deterministic providers and a controlled clock.
- [ ] Enforce actor/Business scope for the reads, writes, provider events and queued work touched here; validate external data and keep public errors and diagnostics safe.
- [ ] Apply the accepted discovery/handler/worker boundaries and frontend stack/design skills. After final code edits, run Prettier and lint, fix failures and report the results.

## Specification coverage

Source #1 user stories: 7, 21, 97, 99, 101, 102, 107, 127, 130, 145.
Source #1 acceptance scenarios: 26, 30, 31, 39.

<!-- ticket-plan: full-product-2026-11-05:T40 -->
