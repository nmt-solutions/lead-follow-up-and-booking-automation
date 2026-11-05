import type { createRfqApplication } from "../application/rfq";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createRfqHttp(options: {
  application: ReturnType<typeof createRfqApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 512000);
  return {
    read: (request: Request, businessId: string, opportunityId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.read(
            request.headers,
            businessId,
            opportunityId,
          ),
        ),
      ),
    save: (request: Request, businessId: string, opportunityId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.save(
            request.headers,
            businessId,
            opportunityId,
            await body(request),
          ),
        ),
      ),
  };
}
