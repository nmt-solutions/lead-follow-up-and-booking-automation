import type { createMailboxApplication } from "../application/mailboxes";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createMailboxHttp(options: {
  application: ReturnType<typeof createMailboxApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 16 * 1024);
  const app = options.application;
  return {
    get: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(await app.workspace(request.headers, businessId)),
      ),
    save: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await app.save(request.headers, businessId, await body(request)),
        ),
      ),
    queue: (request: Request, businessId: string, mailboxId: string) =>
      respond(async () => {
        const work = await app.queue(
          request.headers,
          businessId,
          mailboxId,
          await body(request),
        );
        return dataResponse({ jobId: work.jobId });
      }),
  };
}
