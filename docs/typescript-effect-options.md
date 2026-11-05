# Effect and traditional TypeScript

Research and decision date: 2026-11-05. Status: accepted for the discovery workflow, with conventional TypeScript elsewhere. [ADR 0010](adr/0010-use-effect-for-discovery-workflow.md) records the boundary. Exa remains the selected search provider under the existing [decision](search-provider-decision.md).

## Selected scope

Use Effect for prospect-discovery orchestration. Keep Next.js routes, React, Better Auth integration and other application workflows conventional TypeScript; retain the selected provider SDKs behind adapters. Use one style inside each application module, with an explicit conversion at its host boundary. The user accepted this bounded scope for its failure handling, budgets and concurrent provider work.

Follow [the corrected TypeScript guide](ts-coding-guide.md) outside discovery, including dependency interfaces and deliberate failure/cancellation/retry policies. Effect consolidates several of those mechanisms within discovery. Neither style establishes tenant isolation, delivery guarantees or permission to contact prospects. Website implementation follows [the Tailwind/shadcn and required design-skill rules](agents/frontend.md).

The implementation decision is accepted; a competing implementation or separate evaluation approval is not a prerequisite. Discovery still needs its normal application-level verification and host integration checks. No application package has been installed by this documentation change.

## Current release and scope

The live npm `latest` metadata reports **Effect 4.1.2**, MIT licensed, with no runtime dependencies in the core package. Effect 4.0 was released on September 30, 2026; this evaluation uses the **v4** documentation. Earlier articles recommending v3 because v4 is beta are historical. Pin the actual implementation version and check individual module stability: a stable major release does not make every ecosystem module stable. [Package metadata](https://registry.npmjs.org/effect/latest), [official release announcement](https://effect.website/blog/releases/effect/40).

Effect is a TypeScript library and execution model. Its central type describes success, expected failures and required services: `Effect<Success, Error, Requirements>`. Expected failures are visible in the type; unexpected defects and interruption still exist. This is stronger information than a `Promise<T>` return type, but not a guarantee that JavaScript can never throw or that every failure has been handled. [Expected errors](https://effect.website/docs/v4/error-management/expected-errors), [unexpected errors](https://effect.website/docs/v4/error-management/unexpected-errors).

The v4 installation guide requires TypeScript 5.9 or newer with strict checking. Verify the pinned Node/runtime requirements against both Vercel and Trigger during implementation; this document does not select a runtime version. [Installation](https://effect.website/docs/v4/getting-started/installation).

## Comparison with this repository's guide

| Concern | Traditional TypeScript in the guide | Effect approach |
| --- | --- | --- |
| HTTP boundary | Thin route authenticates, validates, calls a service and formats a response. | Preserve that boundary; execute the application effect there and map its outcome to an HTTP response. |
| Expected failures | `tryCatch` returns an `ok`-discriminated result, then services throw classified application errors. Only the HTTP boundary uses `APIError`; Promise types do not encode throws. | Model expected failures with tagged types in the error channel; handle or translate them explicitly. |
| Dependencies | Services receive explicit provider/repository/clock interfaces; live composition owns environment configuration. | `Context` describes required services and `Layer` constructs implementations; supply live implementations or deterministic test adapters. |
| Cancellation and cleanup | Add `AbortSignal`, `try/finally` and careful ownership conventions. | Fibers and scopes compose interruption and finalizers. Promise adapters must cooperate with cancellation. |
| Concurrent provider calls | Add bounded concurrency, deadlines, backoff and partial-result policies explicitly. | Compose these policies using Effect primitives, while retaining application-owned spend and retry rules. |
| Validation | Validate incoming requests and provider JSON against schemas before treating them as application models. | Effect Schema is available, but adopting it is a separate choice. Validate external data once at the adapter boundary with the chosen schema library. |
| Testing | Inject deterministic adapters and the clock through ordinary interfaces. | Provide test services and a controlled clock. The agreed application-level test seam remains the same. |
| Adoption cost | Familiar `async`/`await`, with more locally maintained conventions. | Learn errors, requirements, layers, fibers and scopes; maintain a deliberate Promise boundary and version discipline. |

Effect's service and resource features are documented in [Managing Services](https://effect.website/docs/v4/requirements-management/services), [Managing Layers](https://effect.website/docs/v4/requirements-management/layers) and [Resource Management](https://effect.website/docs/v4/resource-management/introduction). Its [retry policy](https://effect.website/docs/v4/error-management/retrying) and [TestClock](https://effect.website/docs/v4/testing/testclock) can support the corresponding application policies. The fit assessment in the table is our architectural inference, not a claim of a certified integration with this stack.

## Corrections applied to the traditional guide

The user approved correcting the guide alongside scoped Effect adoption. Its examples now implement the following corrections:

1. **Sanitize unexpected errors.** `APIResponse.fromError` returns a generic server error with a request ID for unknown exceptions. Only deliberately public messages/details reach the response; diagnostics are sanitized internally.
2. **Use a reliable result discriminant.** `tryCatch` returns `{ ok: true, data } | { ok: false, error: unknown }`. Callers inspect `ok`, so falsey thrown values remain failures.
3. **Keep caught values unknown.** The caller-selected error generic and unsafe cast are removed. Runtime guards/classifiers establish error types; Effect adapters require the same care.
4. **Separate application failures from HTTP.** Conventional services throw classified application errors; routes map them to `APIError`/HTTP responses. Discovery keeps typed workflow failures, with separate route/task mappings.
5. **Make fallback decisions explicit.** The helper's automatic default-value behavior is removed. Provider failure remains distinguishable from zero matches, available budget and successful delivery.
6. **Validate provider output and inject dependencies.** The service example validates unknown provider JSON and receives its provider/validation dependencies explicitly.

Keep the guide's useful conventions: thin routes, flat success paths, early exits, server-only secrets, explicit HTTP status checks and request observability.

## Accepted boundaries for the selected stack

| Module or host | Selected implementation |
| --- | --- |
| Next.js routes and React | Normal framework entry points. Authenticate and validate at the appropriate boundary; call application modules through a small bridge. Keep server orchestration dependencies out of client imports. |
| Discovery application module | Effect: budget reservation, Exa lookup, bounded verification, evidence persistence, partial outcomes and stop reasons. Simple pure domain functions remain ordinary TypeScript. |
| Mailbox/calendar synchronization | Conventional TypeScript for now. Extending Effect beyond discovery is a future scope decision. |
| Exa, Gmail, Graph, Meta, Razorpay and AI SDK | Retain selected SDKs/APIs behind adapters. Wrap Promise operations only when composing them into an Effect module; classify errors and pass an abort signal when the actual SDK supports one. No replacement AI framework or search provider is proposed. |
| Better Auth | Retain its native Next.js handlers and Drizzle adapter. An application session/authorization service may expose results to Effect; Effect does not replace authentication or RBAC. |
| Drizzle and `pg` | Retain one reviewed transaction path. Business context and protected queries run on the same transaction connection under the correct role. Resolve the effect inside the transaction callback; allow failure/interruption to reject the callback so rollback occurs. Do not start unawaited fibers that outlive the transaction. |
| Trigger.dev | Own durable task dispatch, persisted scheduling/waits, recovery and task-level retries. An Effect module can execute within a task attempt. Database state and provider reconciliation still determine whether an external action occurred. |

This preserves [ADR 0001](adr/0001-share-typescript-across-web-and-workers.md), [ADR 0003](adr/0003-run-durable-jobs-on-managed-workers.md) and [ADR 0004](adr/0004-use-interactive-postgres-transactions.md). Replacing Trigger with Effect workflows, Drizzle with Effect SQL, or the AI SDK with Effect AI would reopen separate decisions and is outside the selected scope.

### Execution, cancellation and state

Keep effects composable inside a module and execute them once at the Next.js/Trigger host boundary. `runPromise` bridges to Promise code; `runPromiseExit` retains structured success/failure information, including defects. Inspect that outcome deliberately when mapping public errors or task retry decisions. Do not call `runPromise` throughout internal functions and erase the error/dependency information. [Running effects](https://effect.website/docs/v4/getting-started/running-effects).

In v4, `runPromise` can reject with the expected failure value itself; do not assume a v3 `FiberFailure` wrapper or an `APIError`. A host adapter must deliberately translate typed failures, defects and interruption. Wrapping a Promise with `tryPromise` also needs classification of synchronous throws, rejected Promises and any SDK errors returned as successful values. Link the host's cancellation signal through the runner and adapter to SDKs that support it. [Effect API](https://effect.website/docs/v4/api/effect/Effect).

`ManagedRuntime` can share constructed services within a process. It is not shared durable state across Vercel instances or Trigger workers. Supply Business context per invocation; never mutate a shared runtime with the current Business. Runtime lifetime, pools and shutdown cleanup need a host-specific implementation. [Runtime documentation](https://effect.website/docs/v4/runtime).

Do not put a transient external availability check into permanent runtime initialization without recovery: a failed initial `ManagedRuntime` build remains failed for that instance. Keep construction and runtime replacement policies explicit. [Runtime documentation](https://effect.website/docs/v4/runtime).

Wrapping a whole Drizzle transaction in `tryPromise` does not automatically cancel SQL, cause rollback or prevent a commit after interruption. The transaction callback must observe failure and reject as appropriate; await database completion/cleanup and verify the pinned driver's behavior before releasing the connection. [Drizzle transactions](https://orm.drizzle.team/docs/transactions).

A fiber, local semaphore, cache or scheduled sleep is not a persisted workflow or a global rate limit. Effect also has higher-level workflow facilities, but none is selected here. Use PostgreSQL and Trigger for cross-run state, scheduling and coordination. Cleanup cannot be guaranteed after the host process is forcibly terminated.

Cancellation of an effect cannot undo an email, payment or booking already accepted by a provider. Nor does it automatically stop an SDK that ignores abort signals. Keep idempotency records, ambiguous-result reconciliation and the existing authorization/approval checks. In particular:

- Reserve and account for provider spend across workers; a local concurrency limit cannot enforce the Global budget.
- Choose one retry owner at each boundary. Do not multiply SDK, Effect and Trigger retries. Bound attempts, total time and spend; retry only classified failures where the operation is safe.
- Recheck approval, opt-out, human takeover and sender health immediately before an outbound action.
- Represent a legitimate budget stop or partial discovery result as an explicit business outcome with its stop reason, rather than disguising it as provider failure or empty success.
- Await all request-owned work before returning. Follow-ups that must survive the request belong in durable tasks.

These are product/architecture requirements for either programming style, not guarantees supplied by the library.

## Verification boundary

Keep the approved seam: Business setup → discovery → outreach approval → inquiry handling → outcome, with real internal workflow/persistence, deterministic external adapters and a controlled clock. Assert visible state and outbound effects; avoid tests of layer construction, private generator steps or fiber structure.

When implementing discovery, verify provider rate limiting and a bounded retry, budget exhaustion with preserved partial results, invalid external data, cancellation and cross-Business isolation. Confirm that expected failures remain distinguishable at the route/task boundary, finalizers complete within the host lifetime, and no invocation-owned work is left running. A parallel traditional implementation is not required.

Implementation should also measure dependency/bundle impact, cold-start behavior and representative worker duration/memory. Published library benchmarks do not establish savings for our workload. No real-provider integration has been validated by this document.

## Cost impact

Effect's MIT-licensed core adds **USD 0 in mandatory library subscription fees**. This exploration selects no paid service and leaves the [priced infrastructure baseline](operating-costs.md) unchanged. Optional vendor services/support are not selected. Runtime compute/memory, implementation effort, learning, upgrades and maintenance are unmeasured costs; do not claim hosting savings or a development-time estimate without the representative slice. [Package licence and metadata](https://registry.npmjs.org/effect/latest).

## Recorded decision

Use **Effect for discovery orchestration**, conventional Next.js handlers and other workflows, and Trigger.dev for durable jobs. The corrected guide and required Tailwind/shadcn/design-skill frontend rules are accepted implementation policy. Broad Effect adoption or replacement of a selected service requires a separate decision.
