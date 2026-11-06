import type { createOperationsApplication } from "../application/operations";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createOperationsHttp(d: {
  application: ReturnType<typeof createOperationsApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(d.reportFailure),
    body = createJsonBodyReader(d.origin, 8192),
    app = d.application;
  return {
    get: (request: Request, businessId: string | null, operator = false) =>
      respond(async () => {
        const url = new URL(request.url),
          before = url.searchParams.get("before");
        return dataResponse(
          await app.workspace(
            request.headers,
            businessId,
            operator,
            before ? { before: Number(before) } : {},
          ),
        );
      }),
    command: (request: Request, businessId: string, operator = false) =>
      respond(async () =>
        dataResponse(
          await app.recover(
            request.headers,
            businessId,
            await body(request),
            operator,
          ),
        ),
      ),
    acknowledge: (request: Request, businessId: string, operator = false) =>
      respond(async () =>
        dataResponse(
          await app.acknowledge(
            request.headers,
            businessId,
            await body(request),
            operator,
          ),
        ),
      ),
    diagnostics: (request: Request) =>
      respond(async () => dataResponse(await app.diagnostics(request.headers))),
    retention: (request: Request) =>
      respond(async () =>
        dataResponse(
          await app.saveRetention(request.headers, await body(request)),
        ),
      ),
    prune: (request: Request) =>
      respond(async () => {
        await body(request);
        return dataResponse(await app.prune(request.headers));
      }),
  };
}
