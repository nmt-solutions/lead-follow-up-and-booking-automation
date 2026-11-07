import type { createDiscoveryCapacityApplication } from "../application/discovery-capacity";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createDiscoveryCapacityHttp(options: {
  application: ReturnType<typeof createDiscoveryCapacityApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 262144);
  return {
    get: (request: Request) =>
      respond(async () =>
        dataResponse(await options.application.configuration(request.headers)),
      ),
    configure: (request: Request) =>
      respond(async () =>
        dataResponse(
          await options.application.configure(
            request.headers,
            await body(request),
          ),
        ),
      ),
  };
}
