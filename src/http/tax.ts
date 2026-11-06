import type { createTaxApplication } from "../application/tax";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createTaxHttp(options: {
  application: ReturnType<typeof createTaxApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure),
    body = createJsonBodyReader(options.origin, 256 * 1024),
    app = options.application;
  return {
    get: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.workspace(request.headers, id)),
      ),
    calculate: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await app.calculate(request.headers, id, await body(request)),
        ),
      ),
    rules: (request: Request) =>
      respond(async () => dataResponse(await app.rules(request.headers))),
    saveRule: (request: Request) =>
      respond(async () =>
        dataResponse(await app.saveRule(request.headers, await body(request))),
      ),
    decideRule: (request: Request) =>
      respond(async () =>
        dataResponse(
          await app.decideRule(request.headers, await body(request)),
        ),
      ),
    queue: (request: Request) =>
      respond(async () => dataResponse(await app.reviewQueue(request.headers))),
    reviewWorkspace: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.reviewWorkspace(request.headers, id)),
      ),
    resolve: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await app.resolve(request.headers, id, await body(request)),
        ),
      ),
  };
}
