import { z } from "zod";
import type { createWhatsAppApplication } from "../application/whatsapp";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createWhatsAppHttp(options: {
  application: ReturnType<typeof createWhatsAppApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 16 * 1024);
  return {
    reviewGet: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.reviewWorkspace(
            request.headers,
            businessId,
          ),
        ),
      ),
    reviewCommand: (request: Request, businessId: string) =>
      respond(async () => {
        const parsed = z
          .strictObject({
            action: z.enum(["approveEvidence", "revokeEvidence"]),
            input: z.unknown(),
          })
          .safeParse(await body(request));
        if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
        return dataResponse(
          await options.application[parsed.data.action](
            request.headers,
            businessId,
            parsed.data.input,
          ),
        );
      }),
    get: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.workspace(request.headers, businessId),
        ),
      ),
    command: (request: Request, businessId: string) =>
      respond(async () => {
        const parsed = z
          .strictObject({
            action: z.enum([
              "save",
              "start",
              "complete",
              "refresh",
              "register",
              "disconnect",
            ]),
            input: z.unknown(),
          })
          .safeParse(await body(request));
        if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
        const { action, input } = parsed.data;
        return dataResponse(
          await options.application[action](request.headers, businessId, input),
        );
      }),
  };
}
