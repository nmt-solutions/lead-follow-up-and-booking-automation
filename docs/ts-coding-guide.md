# TypeScript Coding Guide

Use conventional TypeScript for Next.js handlers, authentication integration and application modules outside prospect discovery. Use Effect for the discovery workflow, with the scope and host boundaries in [ADR 0010](adr/0010-use-effect-for-discovery-workflow.md). Trigger.dev continues to own durable jobs, scheduling and task recovery.

The examples below illustrate conventional server code using a weather endpoint. `@/` refers to `src/`. Authentication, validation, request observability and live provider composition are application-specific helpers, not additional selected libraries.

## Boundaries

- Routes authenticate, validate untrusted input, invoke application services and format HTTP responses.
- Application services contain business logic and use injected provider, repository and clock interfaces. Shared service failures describe application conditions; HTTP mapping belongs at the route boundary.
- Keep the success path flat. Check a discriminated result immediately, exit on failure and then continue. Services return successful data or throw a classified application error; they do not return error objects as successful data.
- Use strict TypeScript. Treat caught values and external JSON as `unknown` until validated or classified. A type assertion does not establish a provider response or error type.
- Keep environment access and credentials in server-only composition modules. Never import server adapters or discovery runtimes into client components.
- Pass trusted actor/Business context explicitly. Authorization, Business-scoped transactions and non-bypassed RLS remain required with either programming style.

## Route handler

This example assumes `withRequestObservability` supplies a server-generated request ID to its callback, and `recordRequestFailure` records sanitized diagnostics. The wrapper's implementation must adapt that contract to Next.js's route signature. Logging must redact credentials, tokens, provider URLs containing secrets and sensitive payloads; it must not serialize an arbitrary caught object directly.

For endpoints accepting input, validate with a schema from `src/models/` before calling the service. Validate at each untrusted entry point, including tasks and incoming events; derive the Business from authenticated context rather than trusting a request field.

```ts
import { NextRequest } from "next/server";
import { APIResponse } from "@/models/api";
import { weatherRequestSchema } from "@/models/weather";
import { authenticate } from "@/services/auth";
import { weatherDependencies } from "@/services/providers/weather";
import {
  recordRequestFailure,
  withRequestObservability,
} from "@/services/request-observability";
import { validate } from "@/services/validation";
import { getCurrentWeather } from "@/services/weather";

export const GET = withRequestObservability(
  async (req: NextRequest, { requestId }) => {
    try {
      await authenticate(req);

      const input = validate(weatherRequestSchema, {
        location: req.nextUrl.searchParams.get("location"),
      });

      const data = await getCurrentWeather(input, weatherDependencies);

      return APIResponse.fromData({ data, message: "Weather data fetched" });
    } catch (error: unknown) {
      recordRequestFailure(error, { requestId });
      return APIResponse.fromError(error, { requestId });
    }
  },
);
```

Authentication and validation helpers translate their own known failures into the application/HTTP boundary contract. Unknown exceptions receive the generic server response below. Expected request cancellation needs its own host policy and should not be relabeled as a retryable provider outage.

## Application errors

Define shared conventional service failures in `src/models/application-error.ts`. Codes describe application conditions, with no HTTP status or public provider message. Keep a cause for controlled diagnostics; response mapping never serializes it.

```ts
export type ApplicationErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_RESPONSE";

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ApplicationError";
  }
}
```

Add domain-specific codes/types where callers need distinct recovery. A Trigger task maps known failures to its retry/stop policy; it does not use an HTTP status as its business contract. Ordinary Promise return types do not encode thrown errors, so document/classify that contract at the module boundary.

## Service function and early exits

Define the service in `src/services/weather.ts`. `Weather` is the validated application model. The live composition module supplies `parseWeather` using the selected provider schema; it returns `Weather` or throws on invalid data. No schema library is selected by this example.

```ts
import type { Weather } from "@/models/weather";
import { ApplicationError } from "@/models/application-error";
import tryCatch from "@/utils/try-catch";

export type WeatherDependencies = {
  fetch: typeof fetch;
  apiUrl: string;
  apiKey: string;
  parseWeather: (value: unknown) => Weather;
};

export const getCurrentWeather = async (
  { location }: { location: string },
  dependencies: WeatherDependencies,
): Promise<Weather> => {
  const weatherUrl = new URL("/v1/current.json", dependencies.apiUrl);
  weatherUrl.searchParams.set("key", dependencies.apiKey);
  weatherUrl.searchParams.set("q", location);
  weatherUrl.searchParams.set("aqi", "no");

  const response = await tryCatch(() =>
    dependencies.fetch(weatherUrl, { cache: "no-store" }),
  );

  if (!response.ok) {
    throw new ApplicationError("PROVIDER_UNAVAILABLE", {
      cause: response.error,
    });
  }

  if (!response.data.ok) {
    throw new ApplicationError("PROVIDER_UNAVAILABLE");
  }

  const json = await tryCatch((): Promise<unknown> => response.data.json());

  if (!json.ok) {
    throw new ApplicationError("INVALID_PROVIDER_RESPONSE", {
      cause: json.error,
    });
  }

  const parsed = await tryCatch(() => dependencies.parseWeather(json.data));

  if (!parsed.ok) {
    throw new ApplicationError("INVALID_PROVIDER_RESPONSE", {
      cause: parsed.error,
    });
  }

  return parsed.data;
};
```

A failed HTTP status needs a separate check: `fetch` can resolve for an HTTP error response. Real adapters must distinguish rate limits, permission failures, cancellation and retryable outages where the application policy differs. Supply bounded provider deadlines and cancellation through the adapter's actual supported API. The example's coarse weather errors are not a discovery retry taxonomy.

Keep provider response bodies and credential-bearing URLs out of public errors and logs. Perform external I/O outside tenant transactions unless a reviewed operation specifically requires otherwise; protected database work and transaction-local Business context belong on the same transaction connection.

## APIResponse and APIError

Define HTTP formatting in `src/models/api.ts`. `APIError` is a deliberate public boundary error. Construct it only from safe, allowlisted messages and field-validation details; do not copy an arbitrary provider error's message, payload or stack into it.

```ts
import { NextResponse } from "next/server";
import {
  ApplicationError,
  type ApplicationErrorCode,
} from "@/models/application-error";

type PublicFieldErrors = Readonly<Record<string, readonly string[]>>;

type PublicFailure = {
  statusCode: number;
  message: string;
};

const publicFailures = {
  INVALID_INPUT: { statusCode: 400, message: "Check the request fields" },
  UNAUTHENTICATED: { statusCode: 401, message: "Sign in to continue" },
  FORBIDDEN: { statusCode: 403, message: "You cannot perform this action" },
  NOT_FOUND: { statusCode: 404, message: "The requested item was not found" },
  PROVIDER_UNAVAILABLE: {
    statusCode: 502,
    message: "The provider is unavailable",
  },
  INVALID_PROVIDER_RESPONSE: {
    statusCode: 502,
    message: "The provider returned an invalid response",
  },
} satisfies Record<ApplicationErrorCode, PublicFailure>;

export class APIError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly errors: PublicFieldErrors | null;

  constructor({
    code,
    message,
    statusCode,
    errors = null,
  }: PublicFailure & { code: string; errors?: PublicFieldErrors | null }) {
    super(message);
    this.name = "APIError";
    this.code = code;
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

function toAPIError(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  if (error instanceof ApplicationError) {
    return new APIError({ code: error.code, ...publicFailures[error.code] });
  }

  return new APIError({
    code: "INTERNAL_ERROR",
    message: "Server Error",
    statusCode: 500,
  });
}

export class APIResponse {
  static fromData<T>({
    data,
    message,
    statusCode = 200,
  }: { data: T; message: string; statusCode?: number }) {
    return NextResponse.json(
      { success: true, message, data },
      { status: statusCode },
    );
  }

  static fromError(error: unknown, { requestId }: { requestId: string }) {
    const publicError = toAPIError(error);

    return NextResponse.json(
      {
        success: false,
        code: publicError.code,
        message: publicError.message,
        data: null,
        errors: publicError.errors,
        requestId,
      },
      { status: publicError.statusCode },
    );
  }
}
```

All unexpected thrown values, including ordinary `Error` objects, produce the generic `500` response and request ID. Only classified public failures expose their safe message/details. Error causes and stacks stay in sanitized internal diagnostics.

## tryCatch utility

Define this in `src/utils/try-catch.ts`. Pass a callback so invocation, synchronous throws and Promise rejection are all caught. The `ok` discriminant correctly handles `throw null`, `throw 0` and `throw ""`; caught values remain `unknown`.

```ts
export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: unknown };

export default async function tryCatch<T>(
  operation: () => T,
): Promise<Result<Awaited<T>>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}
```

Check `result.ok`, not the truthiness of `result.error`. Classify unknown errors with runtime guards. The utility has no caller-selected error generic and no automatic fallback parameter. Handle an intentional fallback explicitly at the call site; provider failures must remain distinguishable from zero matches, exhausted budgets and successful delivery.

## Effect discovery workflow

- Discovery application modules return composable Effects with typed expected failures and required services. Pure domain functions remain ordinary TypeScript. Keep Effects intact inside the workflow and execute them at the Next.js/Trigger boundary.
- Provide live or deterministic adapters and the controlled clock through discovery services. Validate provider data and classify unknown failures when adapting Promise SDKs. Expected failures, defects and interruption are distinct; `runPromiseExit` preserves that structure for deliberate HTTP/task mapping.
- Keep discovery domain failures independent of `APIError`. A budget stop or partial run is an explicit business outcome with preserved results and a stop reason. Map known failures to safe public responses or task retry/stop behavior at the corresponding host.
- Propagate cancellation from the host through the runner to cooperating adapters. Await owned work and cleanup; interruption cannot undo accepted external actions or cancel SQL automatically.
- Trigger.dev owns persisted schedules/waits and task recovery. Coordinate SDK, Effect and task retries under one bounded time/attempt/spend policy. PostgreSQL owns shared budgets, idempotency and cross-worker state.
- Keep Business context invocation-scoped and protected queries transaction-scoped. Effect SQL, AI, HTTP-server and durable-workflow replacements are outside the selected scope.
- Preserve the agreed application-level tests with deterministic providers and a controlled clock. Assert visible state and outbound effects, including partial results, cancellation, isolation and ambiguous-action recovery.

The [Effect decision and research](typescript-effect-options.md) provides the detailed integration constraints. Other workflows remain conventional TypeScript for now.

## Frontend work

Website code uses Tailwind CSS and shadcn/ui. Before writing or changing frontend code, apply both `apple-design` and `apple-design-diwu` as required by [the frontend rules](agents/frontend.md).
