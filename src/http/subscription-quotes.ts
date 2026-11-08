import type { createSubscriptionQuoteApplication } from "../application/subscription-quotes";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createSubscriptionQuoteHttp(options: {
  application: ReturnType<typeof createSubscriptionQuoteApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 256 * 1024);
  const app = options.application;
  return {
    catalog: (request: Request) =>
      respond(async () => dataResponse(await app.catalog(request.headers))),
    configure: (request: Request) =>
      respond(async () =>
        dataResponse(await app.configure(request.headers, await body(request))),
      ),
    workspace: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.workspace(request.headers, id)),
      ),
    create: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await app.createQuote(request.headers, id, await body(request)),
        ),
      ),
    quote: (request: Request, id: string, quoteId: string) =>
      respond(async () =>
        dataResponse(await app.quote(request.headers, id, quoteId)),
      ),
  };
}
