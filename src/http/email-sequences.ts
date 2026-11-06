import { z } from "zod";
import type { createEmailSequenceApplication } from "../application/email-sequences";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createEmailSequenceHttp(d: {
  application: ReturnType<typeof createEmailSequenceApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const respond = createResponder(d.reportFailure),
    body = createJsonBodyReader(d.origin, 32 * 1024);
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
            command: z.enum(["start", "command", "configure", "classifyReply"]),
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
