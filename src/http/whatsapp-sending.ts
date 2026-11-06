import { z } from "zod";
import type { createWhatsAppSendingApplication } from "../application/whatsapp-sending";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createWhatsAppSendingHttp(d: {
  application: ReturnType<typeof createWhatsAppSendingApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(d.reportFailure),
    body = createJsonBodyReader(d.origin, 256 * 1024);
  return {
    get: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await d.application.workspace(request.headers, businessId),
        ),
      ),
    command: (request: Request, businessId: string) =>
      respond(async () => {
        const parsed = z
          .strictObject({
            action: z.enum([
              "permission",
              "revokePermission",
              "template",
              "bindReplyTemplate",
              "savePlan",
              "decide",
              "start",
              "cancelPlan",
              "estimate",
              "reconcile",
            ]),
            input: z.unknown(),
          })
          .safeParse(await body(request));
        if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
        return dataResponse(
          await d.application[parsed.data.action](
            request.headers,
            businessId,
            parsed.data.input,
          ),
        );
      }),
  };
}
