import type { createAppointmentApplication } from "../application/appointments";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createAppointmentHttp(options: {
  application: ReturnType<typeof createAppointmentApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 16384);
  const command =
    (
      method:
        | "availability"
        | "request"
        | "book"
        | "reconcile"
        | "cancel"
        | "evidence",
    ) =>
    (request: Request, businessId: string, opportunityId: string) =>
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
    configure: (request: Request, businessId: string, opportunityId: string) =>
      respond(async () => {
        // Validate the Opportunity path before changing Business-wide configuration.
        await options.application.read(
          request.headers,
          businessId,
          opportunityId,
        );
        await options.application.configure(
          request.headers,
          businessId,
          await body(request),
        );
        return dataResponse(
          await options.application.read(
            request.headers,
            businessId,
            opportunityId,
          ),
        );
      }),
    availability: command("availability"),
    request: command("request"),
    book: command("book"),
    reconcile: command("reconcile"),
    cancel: command("cancel"),
    evidence: command("evidence"),
  };
}
