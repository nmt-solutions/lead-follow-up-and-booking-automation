import { z } from "zod";
import type { createEmailEligibilityApplication } from "../application/email-eligibility";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createEmailEligibilityHttp(options: {
  application: ReturnType<typeof createEmailEligibilityApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure),
    body = createJsonBodyReader(options.origin, 64 * 1024),
    app = options.application;
  return {
    get: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(await app.workspace(request.headers, businessId)),
      ),
    post: (request: Request, businessId: string) =>
      respond(async () => {
        const parsed = z
          .strictObject({
            command: z.enum([
              "recipient",
              "suppression",
              "policy",
              "review",
              "evaluate",
            ]),
            input: z.unknown(),
          })
          .safeParse(await body(request));
        if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
        const { command, input } = parsed.data;
        if (command === "recipient")
          await app.saveRecipient(request.headers, businessId, input);
        else if (command === "suppression")
          await app.suppress(request.headers, businessId, input);
        else if (command === "policy")
          await app.publishPolicy(request.headers, businessId, input);
        else if (command === "review")
          await app.reviewContent(request.headers, businessId, input);
        else await app.evaluate(request.headers, businessId, input);
        return dataResponse(await app.workspace(request.headers, businessId));
      }),
  };
}
