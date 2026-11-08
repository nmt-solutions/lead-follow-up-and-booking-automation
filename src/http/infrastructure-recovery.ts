import type { createRecoveryApplication } from "../application/infrastructure-recovery";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";
export function createRecoveryHttp(d: {
  application: ReturnType<typeof createRecoveryApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const respond = createResponder(d.reportFailure),
    body = createJsonBodyReader(d.origin, 2048);
  return {
    get: (request: Request) =>
      respond(async () =>
        dataResponse(await d.application.workspace(request.headers)),
      ),
    request: (request: Request) =>
      respond(async () =>
        dataResponse(
          await d.application.request(request.headers, await body(request)),
        ),
      ),
    resume: (request: Request) =>
      respond(async () =>
        dataResponse(
          await d.application.run(request.headers, await body(request)),
        ),
      ),
    costs: (request: Request) =>
      respond(async () =>
        dataResponse(
          await d.application.reconcileCosts(
            request.headers,
            await body(request),
          ),
        ),
      ),
  };
}
