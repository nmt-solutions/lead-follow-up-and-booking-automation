# Discovery execution capacity

Reserved capacity is a finite allocation of **concurrent discovery runs** within operator-approved Trigger.dev Cloud capacity. Pooled execution is the default for an active paid contract without a reserved option. Both modes use the same discovery workflow, Business isolation, source permissions, evidence, approved budgets and paid allowances. This is a logical execution allocation on managed workers, with no physical isolation, lead or throughput guarantee.

## Purchase and approval

The existing pricing/quote/payment flow quotes an optional capacity option with its own amount and reviewed tax treatment. A draft quote, approved quote or pending checkout grants no execution entitlement. `current_paid_contract` supplies the actual captured contract, including approved #47 changes and #46 lifecycle/access rules. The option ID, offer ID, quantity and unit must match an operator-approved allocation exactly. Each allocation separately states `concurrentRuns` and reviewed `mappingEvidence` tying the purchased contract capacity to this finite provider allocation. No concurrency is inferred from a unit label, and there is no automatic conversion or extra billing.

At `/platform/discovery-capacity`, an operator with the existing `discovery` capability and current 15-minute MFA approves:

- The provider project, reviewed deployment, evidence of purchased provider capacity, approval expiry and maximum native-observation age.
- A finite total, pooled allocation and Business-specific reserved allocations. Their sum cannot exceed the total; unallocated headroom is unused.
- The supported fallback policy: **wait**. A busy native lane queues work. Unknown, stale, paused or mismatched provider capacity leaves dispatch pending or stops unsafe running work with retained progress. Reserved work never silently borrows pooled capacity.

No provider quota, capacity purchase, customer price, configuration row or live activation is seeded. Provider evidence is an attributable operator reference, not an invented provider API or automatic proof of a purchase.

## Deployment and runtime gates

After approval, copy the revision's deployment manifest to `DISCOVERY_CAPACITY_DEPLOYMENT_JSON` in both the web and Trigger deployment. The manifest contains `{ id, version, policy }`. Use the approved project's actual `TRIGGER_PROJECT_REF` and matching environment credentials. The deployment reference and evidence must identify the actual reviewed Cloud environment and its paid capacity. Keep the policy's expiry and observation age explicit. Existing worker/provider/recovery-cron activation requirements still apply.

Deploy `src/trigger/discovery.ts` with the installed SDK **4.8.3**. It registers these finite named limits:

- `discovery-provider-<policyId>`: total discovery bound.
- `discovery-pooled-<policyId>`: pooled partition.
- `discovery-reserved-<policyId>-<businessId>`: each reserved allocation.

The task additionally declares an inline **total** bound. Every actual discovery enqueue supplies both the provider limit and selected lane. This preserves the aggregate bound when Trigger's trigger-time named limits replace task-declared named limits. No per-key-only ceiling or dynamically created queue is used. A missing manifest disables configured execution; the inactive task's defensive inline bound is not a commercial activation default.

Before enqueue and worker execution, the adapter retrieves **all** declared native partitions, checks finite current/base totals, rejects overrides, per-key bounds, paused or legacy task queues, pause state and unknown responses, and rechecks the original actor/session, paid contract, source policy, stop state and immutable binding after native I/O/Business locks. Trusted PostgreSQL time fences expiry and observation age. Private workspace reads reauthenticate the original request after native availability I/O and read current scoped evidence afterward. It repeats the checks before each discovery provider operation; current binding checks also run inside the locked discovery guard/reservation transactions. A failed observation during an active run retains results and requires explicit recovery/resume, never additional unapproved allowance.

The transactional outbox binds the run's original execution key to the exact paid contract and approval revision. Unknown native acceptance retries the identical payload with global key `discovery-<runId>-<executionKey>` and the existing 30-day TTL. Run identity, native attempt recovery, provider-operation uncertainty, budgets and durable Trigger scheduling remain intact. Queued delayed schedule events create discovery work only when due, using the then-current paid contract. A new policy revision invalidates older execution bindings; it does not move or resume work. Operators must review unresolved accepted work before changing deployment, then obtain explicit resume where supported.

## Database rollout contract

Use the project's complete managed `prepare → drizzle-kit push → secure` workflow, under the integration owner's rollout authority. Do not apply a fragment or use the runtime role as schema owner. New schema objects are `discovery_capacity_policy` and `discovery_capacity_binding`, both forced-RLS append-only ledgers with separate SELECT and INSERT startup assertions. Their ordinary foreign keys reference stable primary keys; no new replaceable composite UNIQUE dependency is introduced. The managed security step restores all four policies and both source triggers, revokes PUBLIC access, installs the two fixed-empty-search-path helpers and verifies runtime nonownership. The trigger helper is private to the database; only the scoped route projection is runtime-executable. Owner default function/table ACLs are hardened against PUBLIC grants without changing existing function bodies. Reapply the full schema on populated data to verify preservation.

The merger owns actual-target database changes. No backup/restore, provider purchase or Trigger deployment is part of schema application. Business stop/offboarding remains authoritative. A quarantined recovery deployment must not activate this manifest or resume queues; #58's quarantine authority must remain in force.

## User verification

1. Configure an optional capacity offer and reviewed tax treatment; create a quote. Check initial/renewal amounts, capacity quantity/unit and the separate no-guarantee disclosure.
2. Prepare/start checkout. Confirm capacity does not execute until authoritative payment reconciliation creates the active contract.
3. With operator approval and verified deployment, open Business discovery. Expect the reserved or pooled allocation, observed availability/counts, observation time and existing progress/usage.
4. Authorize an on-demand run and a saved search. Expect one discovery execution per request/occurrence, the selected lane and sourced results within the approved budget.
5. Pause a native limit or make an observation stale. Expect explicit unavailable/stale status and retained pending work without new spend. Restore the exact approved deployment to recover the same dispatch.
6. Change/expire the allocation or revoke the actor while work waits. Expect execution to stop, retained results and no automatic pooled fallback or resume.

UI acceptance, actual provider account capacity and deployment verification are pending operator/user execution.

## Primary sources checked 2026-11-07

- [Trigger concurrency](https://trigger.dev/docs/concurrency): inline totals, shared named limits, trigger-time replacement, current native observations and pause/override semantics.
- [Trigger 4.7 release](https://trigger.dev/changelog/v4-7-0): server-enforced Cloud concurrency and 4.7+ SDK contract; the installed 4.8.3 SDK definitions/registration implementation were checked directly.
- [Trigger task queue retrieval](https://trigger.dev/docs/management/queues/retrieve): task queue identity, V2 metadata and native queue pause state.
- [Trigger Cloud pricing and managed compute](https://trigger.dev/pricing): capacity is provider-plan/environment dependent and compute is usage-priced. No published commercial amount or quota is copied into application defaults.
