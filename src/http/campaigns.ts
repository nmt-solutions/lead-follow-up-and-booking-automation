import { z } from "zod";
import type { createCampaignApplication } from "../application/campaigns";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createCampaignHttp(d: {
  application: ReturnType<typeof createCampaignApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
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
    post: (request: Request, businessId: string) =>
      respond(async () => {
        const parsed = z
          .strictObject({
            command: z.enum(["save", "decide", "review", "inspect"]),
            input: z.unknown(),
          })
          .safeParse(await body(request));
        if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
        const { command, input } = parsed.data;
        return dataResponse(
          await d.application[command](request.headers, businessId, input),
        );
      }),
  };
}
