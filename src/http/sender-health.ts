import type { createSenderHealthApplication } from "../application/sender-health";
import { healthCommandSchema } from "../models/sender-health";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createSenderHealthHttp(d: {
  application: ReturnType<typeof createSenderHealthApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(d.reportFailure),
    body = createJsonBodyReader(d.origin, 24 * 1024),
    app = d.application;
  return {
    alerts: (request: Request) =>
      respond(async () => dataResponse(await app.alerts(request.headers))),
    get: (request: Request, businessId: string, operator = false) =>
      respond(async () =>
        dataResponse(
          await app.workspace(request.headers, businessId, operator),
        ),
      ),
    command: (request: Request, businessId: string, operator = false) =>
      respond(async () => {
        const parsed = healthCommandSchema.safeParse(await body(request));
        if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
        const input = parsed.data;
        if (input.command === "acknowledge") {
          await app.acknowledge(
            request.headers,
            businessId,
            input.alertId,
            operator,
          );
          return dataResponse({ acknowledged: true });
        }
        if (!operator) throw new ApplicationError("FORBIDDEN");
        if (input.command === "prune")
          return dataResponse(
            await app.prune(request.headers, businessId, input.identityId),
          );
        return dataResponse(
          input.command === "configure"
            ? await app.configure(
                request.headers,
                businessId,
                input.identityId,
                {
                  expectedVersion: input.expectedVersion,
                  policy: input.policy,
                },
              )
            : await app.ingest(
                request.headers,
                businessId,
                input.identityId,
                input.evidence,
              ),
        );
      }),
  };
}
