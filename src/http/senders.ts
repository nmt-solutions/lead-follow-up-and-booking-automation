import type { createSenderApplication } from "../application/senders";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createSenderHttp(options: {
  application: ReturnType<typeof createSenderApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 16 * 1024);
  const app = options.application;
  return {
    get: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(await app.workspace(request.headers, businessId)),
      ),
    saveConnection: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await app.saveConnection(
            request.headers,
            businessId,
            await body(request),
          ),
        ),
      ),
    saveReplyRoute: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await app.saveReplyRoute(
            request.headers,
            businessId,
            await body(request),
          ),
        ),
      ),
    saveIdentity: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await app.saveIdentity(
            request.headers,
            businessId,
            await body(request),
          ),
        ),
      ),
    check: (request: Request, businessId: string, id: string) =>
      respond(async () =>
        dataResponse(
          await app.check(request.headers, businessId, id, await body(request)),
        ),
      ),
  };
}
