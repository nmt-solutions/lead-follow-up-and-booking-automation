import type { createInboxApplication } from "../application/inbox";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createInboxHttp(options: {
  application: ReturnType<typeof createInboxApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 128 * 1024);
  return {
    get: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.workspace(request.headers, businessId),
        ),
      ),
    conversation: (request: Request, businessId: string, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.conversation(
            request.headers,
            businessId,
            id,
          ),
        ),
      ),
    addConnection: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.addConnection(
            request.headers,
            businessId,
            await body(request),
          ),
        ),
      ),
    revokeConnection: (request: Request, businessId: string, id: string) =>
      respond(async () => {
        // Origin/media-type validation applies to commands, including revocation.
        await body(request);
        await options.application.revokeConnection(
          request.headers,
          businessId,
          id,
        );
        return dataResponse({ revoked: true });
      }),
    capture: (request: Request, businessId: string, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.capture(
            request.headers,
            businessId,
            id,
            await body(request),
          ),
        ),
      ),
  };
}
