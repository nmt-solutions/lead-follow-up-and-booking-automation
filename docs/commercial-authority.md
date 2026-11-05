# Commercial authority and approval limits

Issue #9 adds **Commercial authority and approval limits** to the Business profile. Every price, custom quotation, discount and order acceptance starts with automation disabled and approval required. No sales currency, amount, discount allowance or escalation owner is seeded. Subscription billing currencies do not determine a Business's sales currency.

Only a current Business Owner/Admin can save authority. Saves explicitly require the existing privileged MFA proof (12-hour Business assurance), including when the caller was previously a Salesperson. Current membership is checked again inside the Business transaction. Current members can read policy/history and evaluate proposals; reads and evaluation follow the existing role/enrollment MFA policy. External content has no policy-write route or trusted identity.

Each action has independent automation permission, an always-require-approval flag, a currency/amount ceiling, a discount percentage ceiling and an escalation owner. Enabling an action requires an explicit amount ceiling and a current Business Owner/Admin for escalation; enabling discounts also requires a percentage ceiling. Removing or demoting that escalation owner blocks automatic decisions immediately until an authorized actor updates the policy. Historical owner IDs and the changing actor's ID/name remain attributable.

## Limit semantics

- Amount ceilings are inclusive and apply per proposed action to the **total before discount**, in exactly the configured currency. They are not cumulative budgets or per-unit prices. There is no implicit currency conversion. The same rule applies to price, quotation, discount and order decisions.
- API money is `{ "currency": "<explicit ISO currency code>", "minor": "<nonnegative integer string>" }`. Supported currency codes and display precision come from the runtime's Intl currency data. The 30-digit bound is an input/storage bound, not an approved commercial threshold. Comparisons use `BigInt`; decimal entry/display uses strings and the currency's minor-unit precision, without floating point monetary arithmetic.
- Discounts use integer basis points from 0 to 10000; 100 basis points is 1%. The UI accepts percentage text with at most two decimal places. A missing percentage ceiling permits no automatic discount. Zero explicitly means no discount; unknown information is `null` and requires approval.
- A discounted price, quotation or order must satisfy **both** its own rule and the discounts rule, including both amount ceilings and escalation-owner eligibility. Enabling quotation authority cannot silently grant discount authority.
- Disabled automation, required approval, missing information, a missing/currently ineligible escalation owner, currency mismatch or exceeded limits yield `approval_required`, a reason, the affected action, current policy version, check time, an available escalation owner and a next action. Missing owners require Owner/Admin setup. A within-limits decision is `permitted`; it is a snapshot, never a reusable execution grant.

## Persistence and application boundary

`commercial_authority_revision` stores complete append-only policy snapshots with Business, version, actor ID/name, controlled timestamp and change reason. The restricted runtime has SELECT/INSERT only, forced Business RLS and no UPDATE/DELETE/TRUNCATE. The existing Business transaction lock serializes policy writes with membership changes. `expectedVersion` prevents lost updates; stale/concurrent saves return `CONFLICT`. A narrow security-definer helper exposes only current Business Owner/Admin IDs, names and roles to current Business members so Salespeople can see effective escalation ownership without gaining team-management access.

`createCommercialAuthorityApplication` supplies `workspace`, `save` and `evaluate` using injected authentication, real repository and clock. Evaluation reloads current persisted policy and eligible owners on every invocation, with the same Business lock as membership/policy changes. No queued payload or caller-provided policy/version is accepted as authority. Trusted worker composition must authenticate persisted job ownership and apply equivalent MFA/role requirements; this issue creates no worker, queued job or provider-event entry point.

HTTP paths start with `/api/businesses/:businessId/commercial-authority`:

| Method/path      | Input                               | Observable result                                                                       |
| ---------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| GET              | Authenticated Business scope        | Effective policy, version, immutable history, eligible owners and management permission |
| PUT              | `{ expectedVersion, policy, note }` | Complete new revision and updated effective workspace                                   |
| POST `/evaluate` | `{ action, amount, discountBps }`   | Latest-policy decision and explicit handoff context                                     |

Mutation/evaluation require configured same-origin JSON, strict schemas and bounded bodies. Caller-supplied Business/actor/approval/authority fields are rejected. Public errors use allowlisted codes/messages and request IDs; diagnostics never serialize payloads or arbitrary errors. Responses are no-store.

## Scope and verification

This issue implements configuration, persistence, history and current-state commercial-policy evaluation. It does not send messages, issue live quotations, accept orders, approve individual proposals or implement future sales/booking execution. Those execution workflows must call current evaluation immediately before acting, apply current Opportunity ownership and channel/provider requirements, and obtain authoritative confirmation for commitments. A permitted policy check alone confirms no outcome and supplies no channel eligibility.

`tests/commercial-authority.test.ts` exercises the public application/HTTP seam with real isolated PostgreSQL, restricted runtime/RLS, real authentication/MFA and team changes, a controlled clock, and deterministic external mail providers. It observes policy/history/decisions and verifies configuration/evaluation do not send messages. Infrastructure assertions check immutable runtime privileges. No live external commercial provider is needed or activated in this configuration/evaluation scope.

Both required design skills were applied to the source and intended flow: shared semantic Tailwind/shadcn controls, explicit effective status, grouped settings, exact decimal entry, inline validation, retained edits through expired sessions/conflicts, in-context completion and ordinary browser navigation. **UI validation and human acceptance are pending and user-owned.** No browser, screenshots, visual/accessibility audit, measurements, preference emulation or development server was used.

Manual acceptance: open a Business's authority page; verify safe defaults and failed unconfigured checks. Enable a selected action with your chosen currency/limit, escalation owner and reason; save, reload, and inspect actor/time/history. Check proposals at and beyond the limits, mismatched currency and unknown information; expect bounded permission or an explicit handoff. Require every action's approval or disable automation and check the same proposal again; expect immediate approval-required. Try Salesperson, primary-only Owner/Admin and another Business sessions; expect current role/MFA/scope enforcement. Demote/remove an assigned Admin and expect owner-unavailable handoff without rewriting historical revisions.
