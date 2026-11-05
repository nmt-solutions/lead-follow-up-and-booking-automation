import type { createOpportunityApplication } from "../application/opportunity-control";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createOpportunityHttp(options: {
  application: ReturnType<typeof createOpportunityApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 16 * 1024);
  return {
    read: (request: Request, businessId: string, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.read(request.headers, businessId, id),
        ),
      ),
    change: (request: Request, businessId: string, id: string) =>
      respond(async () => {
        await options.application.change(
          request.headers,
          businessId,
          id,
          await body(request),
        );
        return dataResponse({ saved: true });
      }),
    manualReply: (request: Request, businessId: string, connectionId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.manualReply(
            request.headers,
            businessId,
            connectionId,
            await body(request),
          ),
        ),
      ),
    queue: (request: Request, businessId: string, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.queue(
            request.headers,
            businessId,
            id,
            await body(request),
          ),
        ),
      ),
    dispatch: (request: Request, businessId: string, actionId: string) =>
      respond(async () => {
        const input: unknown = await body(request);
        // The body cannot replace persisted job ownership, policy or association snapshots.
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).length
        ) {
          throw new ApplicationError("INVALID_INPUT");
        }
        return dataResponse(
          await options.application.dispatch(
            request.headers,
            businessId,
            actionId,
          ),
        );
      }),
  };
}
