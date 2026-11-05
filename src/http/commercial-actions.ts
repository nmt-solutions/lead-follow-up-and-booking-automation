import type { createCommercialApplication } from "../application/commercial-actions";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createCommercialHttp(options: {
  application: ReturnType<typeof createCommercialApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 32768);
  function command(method: "propose" | "decide" | "execute" | "evidence") {
    return (request: Request, businessId: string, opportunityId: string) =>
      respond(async () =>
        dataResponse(
          await options.application[method](
            request.headers,
            businessId,
            opportunityId,
            await body(request),
          ),
        ),
      );
  }
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
    propose: command("propose"),
    decide: command("decide"),
    execute: command("execute"),
    evidence: command("evidence"),
  };
}
