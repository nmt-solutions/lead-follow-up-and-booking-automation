import type { createEmailSetup } from "../application/email-setup";
import { dataResponse } from "../models/api";
import { createResponder, type FailureDiagnostic } from "./respond";
import { createJsonBodyReader } from "./request-body";
import { setOAuthContext } from "./oauth-context";

export function createEmailSetupHttp(options: {
  application: ReturnType<typeof createEmailSetup>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 1024);
  return {
    start: (request: Request, businessId: string) =>
      respond(async () => {
        const result = await options.application.start(
          request.headers,
          businessId,
          await body(request),
        );
        return setOAuthContext(
          dataResponse(result),
          result.authorizationUrl,
          result.provider,
          { businessId, mailboxId: result.mailboxId },
        );
      }),
  };
}
