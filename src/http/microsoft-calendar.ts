import type { createMicrosoftCalendarApplication } from "../application/microsoft-calendar";
import { dataResponse } from "../models/api";
import { createResponder, type FailureDiagnostic } from "./respond";
import { createJsonBodyReader } from "./request-body";
import { ApplicationError } from "../models/application-error";

export function createMicrosoftCalendarHttp(options: {
  application: ReturnType<typeof createMicrosoftCalendarApplication>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const responder = createResponder(options.reportFailure);
  const respond = async (operation: () => Promise<Response>) => {
    const response = await responder(operation);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const body = createJsonBodyReader(options.origin, 4096);
  return {
    read: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.read(request.headers, businessId),
        ),
      ),
    start: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.start(
            request.headers,
            businessId,
            await body(request),
          ),
        ),
      ),
    select: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.select(
            request.headers,
            businessId,
            await body(request),
          ),
        ),
      ),
    disconnect: (request: Request, businessId: string) =>
      respond(async () => {
        const input = await body(request);
        if (!input || typeof input !== "object" || Object.keys(input).length)
          throw new ApplicationError("INVALID_INPUT");
        return dataResponse(
          await options.application.disconnect(request.headers, businessId),
        );
      }),
    callback: (request: Request, businessId: string) =>
      respond(async () => {
        const params = new URL(request.url).searchParams;
        if (["state", "code", "error"].some((k) => params.getAll(k).length > 1))
          throw new ApplicationError("INVALID_INPUT");
        const result = await options.application.callback(
          request.headers,
          businessId,
          {
            state: params.get("state"),
            ...(params.has("code") ? { code: params.get("code") } : {}),
            ...(params.has("error") ? { error: params.get("error") } : {}),
          },
        );
        return new Response(null, {
          status: 303,
          headers: {
            Location: `${options.origin}${result.returnPath}`,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      }),
  };
}
