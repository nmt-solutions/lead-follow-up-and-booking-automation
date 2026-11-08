import type { createReportingApplication } from "../application/reporting";
import { dataResponse } from "../models/api";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createReportingHttp(d: {
  application: ReturnType<typeof createReportingApplication<Headers>>;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(d.reportFailure);
  return {
    get: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await d.application.read(
            request.headers,
            businessId,
            Object.fromEntries(new URL(request.url).searchParams),
          ),
        ),
      ),
  };
}
