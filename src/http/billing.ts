import type { createBillingApplication } from "../application/billing";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createBillingHttp(options: {
  application: ReturnType<typeof createBillingApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 256 * 1024);
  const app = options.application;
  return {
    get: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.workspace(request.headers, id)),
      ),
    save: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.save(request.headers, id, await body(request))),
      ),
    queue: (request: Request) =>
      respond(async () => dataResponse(await app.reviewQueue(request.headers))),
    reviewWorkspace: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.reviewWorkspace(request.headers, id)),
      ),
    review: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await app.review(request.headers, id, await body(request)),
        ),
      ),
  };
}
