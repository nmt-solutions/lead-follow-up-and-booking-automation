import type { createInquiryApplication } from "../application/inquiries";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";
import { z } from "zod";

export function createInquiryHttp(options: {
  application: ReturnType<typeof createInquiryApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 4096);
  return {
    read: (request: Request, businessId: string, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.read(request.headers, businessId, id),
        ),
      ),
    process: (request: Request, businessId: string, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.process(
            request.headers,
            businessId,
            id,
            await body(request),
          ),
        ),
      ),
    dispatch: (
      request: Request,
      businessId: string,
      id: string,
      runId: string,
    ) =>
      respond(async () => {
        if (!z.strictObject({}).safeParse(await body(request)).success)
          throw new ApplicationError("INVALID_INPUT");
        return dataResponse(
          await options.application.dispatch(
            request.headers,
            businessId,
            id,
            runId,
          ),
        );
      }),
  };
}
