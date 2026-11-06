import { z } from "zod";
import type { createEmailHandoffApplication } from "../application/email-handoffs";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createEmailHandoffHttp(d: {
  application: ReturnType<typeof createEmailHandoffApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const respond = createResponder(d.reportFailure),
    body = createJsonBodyReader(d.origin);
  return {
    get: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await d.application.workspace(request.headers, businessId),
        ),
      ),
    post: (request: Request, businessId: string) =>
      respond(async () => {
        const p = z
          .strictObject({
            command: z.enum(["prepare", "use", "markSent", "bindSent"]),
            input: z.unknown(),
          })
          .safeParse(await body(request));
        if (!p.success) throw new ApplicationError("INVALID_INPUT");
        return dataResponse(
          await d.application[p.data.command](
            request.headers,
            businessId,
            p.data.input,
          ),
        );
      }),
  };
}
