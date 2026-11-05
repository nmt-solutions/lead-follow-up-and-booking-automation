import type { createBusinessApplication } from "../application/business";
import { dataResponse } from "../models/api";
import { createResponder, type FailureDiagnostic } from "./respond";
import { createJsonBodyReader } from "./request-body";

export type BusinessApplication = ReturnType<
  typeof createBusinessApplication<Headers>
>;

export function createBusinessHttp(options: {
  application: BusinessApplication;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);

  const body = createJsonBodyReader(options.origin);

  return {
    list: (request: Request) =>
      respond(async () =>
        dataResponse(await options.application.listBusinesses(request.headers)),
      ),
    create: (request: Request) =>
      respond(async () =>
        dataResponse(
          await options.application.createBusiness(
            request.headers,
            await body(request),
          ),
          201,
        ),
      ),
    get: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.getProfile(request.headers, businessId),
        ),
      ),
    update: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.updateProfile(
            request.headers,
            businessId,
            await body(request),
          ),
        ),
      ),
  };
}
