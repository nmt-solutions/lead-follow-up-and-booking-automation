import type { createCommercialAuthorityApplication } from "../application/commercial-authority";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createCommercialAuthorityHttp(options: {
  application: ReturnType<typeof createCommercialAuthorityApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 16384);
  return {
    get: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await options.application.workspace(request.headers, id)),
      ),
    save: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.save(
            request.headers,
            id,
            await body(request),
          ),
        ),
      ),
    evaluate: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.evaluate(
            request.headers,
            id,
            await body(request),
          ),
        ),
      ),
  };
}
